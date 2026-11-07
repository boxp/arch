#!/usr/bin/env bb
;; BOXP-428: exports finished Task Board runs to self-hosted Langfuse over OTLP/HTTP JSON.
;; Stand-alone sidecar: reads run artifacts and session logs, writes only under
;; <root>/langfuse-exporter, shares no locks with the runner, and never affects a run.
;; Secrets are removed before anything reaches the spool or the network (fail closed).
;; Started by the `task-board-langfuse-exporter` sidecar in boxp/lolice
;; argoproj/codex-workspace/deployment.yaml (boxp/lolice#1071), not by the runner or the
;; image entrypoint: the sidecar calls `once` every LANGFUSE_POLL_SECONDS and re-reads the
;; ingest key from its Secret volume between ticks, so this file has no loop of its own.
(ns langfuse-exporter
  (:require [babashka.fs :as fs]
            [babashka.http-client :as http]
            [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.string :as str]
            [clojure.walk :as walk]))

(def exporter-version "1")

;; ---------------------------------------------------------------- redaction

(def secret-name-pattern
  #"(?i)(password|passwd|passphrase|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential|session[_-]?id|cookie|auth(?!ors?(?![a-z]))|(?<![a-z])pass(?![a-z]))")

(def quote-pattern "(?:\\\\*[\"']|\\\\+u00(?:22|27)|&quot;|&apos;|&#0*(?:34|39);|&#x0*(?:22|27);)")
(def gap-pattern "(?:\\s|\\\\+[nrt])*")
(def secret-key-pattern (str "[\\w.-]{0,64}(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential|session[_-]?id|cookie|authorization|(?<![a-z])pass(?![a-z])|(?<![a-z])auth(?![a-z]))[\\w.-]{0,64}"))
(defn value-pattern [limit bare]
  (str "(?:(?<quote>" quote-pattern ")(?:[^\\n]" (or limit "*?") "(?<!\\\\)\\k<quote>" (when-not limit "|[^\\n]*") ")|" bare ")"))
(def key-start "(?:(?<![\\w-])|(?<=\\\\u00(?:22|27)))") ; a key may follow a \u0022 quote escape
(defn entry-key [name] (str key-start name "(?:" quote-pattern ")?" gap-pattern "[:=]" gap-pattern))
(def entry-gap "(?:\\s|\\\\+[nrt]|,)*")

(def patterns
  [[:private-key #"(?s)-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----.*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|\z)"]
   [:header #"(?im)\b(?:proxy-authorization|authorization|set-cookie|cookie)\s*:\s*[^\r\n]+"]
   [:url-credentials #"(?i)\b[a-z][a-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@"]
   [:jwt #"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"]
   [:provider-key #"\b(?:sk-lf-|pk-lf-|sk-|ghp_|gho_|ghs_|ghu_|github_pat_|xox[baprs]-|npm_|glpat-)[A-Za-z0-9_-]+"]
   [:aws-key #"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"]
   [:google-key #"\bAIza[A-Za-z0-9_-]{30,}\b"]
   [:telegram #"\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b"]
   [:bearer #"(?i)\bbearer\s+[A-Za-z0-9._~+/-]+=*"]
   [:env-entry (re-pattern (str "(?i)" (entry-key "name") "(?:" quote-pattern ")?" secret-key-pattern "(?:" quote-pattern ")?" entry-gap "(?:" quote-pattern ")?" (entry-key "value") (value-pattern nil "[^\\s,;}\\]]+")))]
   [:env-entry (re-pattern (str "(?i)" (entry-key "value") (value-pattern "{0,4096}?" "[^\\s,;}\\]]+") entry-gap "(?:" quote-pattern ")?" (entry-key "name") "(?:" quote-pattern ")?" secret-key-pattern))]
   [:flag (re-pattern (str "(?i)(?<![\\w-])--?" secret-key-pattern "[ \\t]+(?!-)" (value-pattern nil "\\S+")))]
   ;; A CLI password is one shell word: a quoted value runs to its matching quote (value-pattern), so
   ;; sshpass -p 'apple orchard' masks and pins the whole value, not just the part before the space. A quote that never
   ;; closes (-u 'admin:apple orchard) runs to the end of the line, like value-pattern.
   [:cli-password (re-pattern (str "(?i)(?<![\\w-])(?:-u|--user)[ \\t=]*(?<uq>" quote-pattern ")(?!\\d+:\\d+\\b)[^\\s:]*:(?:[^\\n]*?(?<!\\\\)\\k<uq>|[^\\n]*)"))]
   [:cli-password (re-pattern (str "(?i)(?<![\\w-])(?:-u|--user)[ \\t=]*(?!" quote-pattern ")(?!\\d+:\\d+\\b)[^\\s:]+:" (value-pattern nil "\\S+")))]
   [:cli-password (re-pattern (str "(?i)\\b(?:mysql\\w*|mariadb\\w*)\\b[^\\n|;&]{0,512}?\\s-p" (value-pattern nil "\\S+")))]
   [:cli-password (re-pattern (str "(?i)\\bsshpass\\b[^\\n|;&]{0,512}?\\s-p[ \\t]*" (value-pattern nil "\\S+")))]
   ;; A number after a name with token in it is a counter such as input_tokens: 12.
   [:assignment (re-pattern (str "(?i)[\"']?" secret-key-pattern "(?:" quote-pattern ")?" gap-pattern "(?:[:=]|\\\\+u00(?:3[aA]|3[dD]))" gap-pattern "(?!(?<=token[\\w.-]{0,16}[\"'\\\\]{0,8}\\s{0,4}[:=]\\s{0,4})\\d+(?:[\\s,;}\\\\\"']|$))(?:[|>][-+]?\\d?(?:(?:\\n|\\\\+n)[ \\t]+(?:(?!\\\\+n)[^\\n])*)+|" (value-pattern nil "[^\\s,;}\\]]+") ")"))]
   [:entropy #"\b[A-Za-z0-9_-]{40,}\b"]])

(def not-a-credential-name #"^(?:PWD|OLDPWD)$")
(def flag-value #"(?i)true|false|yes|no|on|off|none|null|nil|enabled|disabled|0|1")
;; Whole words of the name, at its ends: MINIO_ROOT_PASSWORD holds "min" and SUPPORT_SECRET holds "port".
(def toggle-last-word #"(?i)enabled?|disabled?|required?|parallelism|rotation")
(def toggle-first-word #"(?i)use|enable|disable|no|skip|require")
(def counter-last-word #"(?i)tokens|count|limit|max|min|ttl|timeout|expiry|expires|interval|seconds|minutes|hours|days|age|size|port|bytes")

(defn setting?
  "The value and the name have to agree: PASSWORD=disabled is a password, AUTH_ENABLED=disabled is a setting."
  [k v]
  (let [words (remove str/blank? (str/split k #"[^A-Za-z0-9]+"))]
    (cond
      (empty? words) false
      (re-matches flag-value v) (boolean (or (re-matches toggle-last-word (last words))
                                             (re-matches toggle-first-word (first words))))
      :else (boolean (and (re-matches #"\d+" v) (re-matches counter-last-word (last words)))))))

(defn secret-value?
  "Short values count too. Only a setting is left alone, since masking it would blank ordinary words and numbers."
  [k v]
  (and (string? v)
       (not (str/blank? v))
       (re-find secret-name-pattern k)
       (not (re-matches not-a-credential-name k))
       (not (setting? k v))))

(defn secret-values [env]
  (->> env
       (keep (fn [[k v]] (when (secret-value? (str k) v) v)))
       ;; A value read from a file keeps its newline; the text shows it without.
       (mapcat (fn [v] [v (str/trim v)]))
       distinct
       (sort-by count >)))

(def control-escapes {10 "n" 13 "r" 9 "t" 8 "b" 12 "f"})
(def html-names {38 "amp" 60 "lt" 62 "gt" 34 "quot" 39 "apos"})

(defn encoded-char
  "Every way serialized text can carry a character, letters and digits included. Escapes can repeat, since JSON can sit inside JSON
  (bounded at 255 backslashes, depth 8, to keep the scan linear) and a URL can be encoded again (%2561, same depth)."
  [code]
  (let [ch (String. (Character/toChars (int code)))
        literal (format "\\x{%x}" code)
        units (if (< code 0x10000)
                [code]
                [(+ 0xD800 (bit-shift-right (- code 0x10000) 10)) (+ 0xDC00 (bit-and (- code 0x10000) 0x3FF))])
        hex-forms (cond-> [(str/join (map #(format "\\\\{1,255}u%04x" %) units))
                           (str/join (map #(format "%%(?:25){0,8}%02x" (bit-and (int %) 0xFF)) (.getBytes ch "UTF-8")))
                           (format "&#0*%d;" code)
                           (format "&#x0*%x;" code)]
                    (< code 0x100) (conj (format "\\\\{1,255}x%02x" code))
                    (html-names code) (conj (str "&" (html-names code) ";")))]
    (str "(?:(?i:" (str/join "|" hex-forms) ")"
         (if (and (< code 128) (re-matches #"[A-Za-z0-9]" ch))
           ;; \n is a newline, not an n
           (str "|" literal)
           (str (when-let [letter (control-escapes code)] (str "|\\\\{1,255}" letter))
                (when (= code 32) "|\\+")
                "|\\\\{1,255}" literal "|" literal))
         ")")))

(defn code-points [s]
  (loop [i 0 out []]
    (if (< i (count s))
      (let [code (Character/codePointAt ^String s (int i))]
        (recur (+ i (Character/charCount (int code))) (conj out code)))
      out)))

(defn value-pattern
  "Every position can start a value, so its first character is only tried at the start of a run of backslashes: the scan stays linear."
  [value]
  (let [[first-char & others] (map encoded-char (code-points value))]
    (str/join (cons (str/replace first-char "\\\\{1,255}" "(?<!\\\\)\\\\+") others))))

(def values-pattern
  "One alternation, longest first, so a later value cannot rewrite the mark of an earlier one.
  Any length matches inside a longer word: the value can be part of it, and a blanked word costs less than a leak."
  (memoize
   (fn [values]
     (when (seq values)
       (re-pattern
        (str/join "|" (map value-pattern (sort-by count > values))))))))

(defn entropy-secret?
  "Ids such as run ids and UUIDs have only short hyphen-separated segments; a token has a
  long mixed-case alphanumeric one. Hex-only values (git SHAs, digests) have no uppercase."
  [s]
  (boolean
   (some (fn [segment]
           (and (<= 20 (count segment))
                (re-find #"[a-z]" segment) (re-find #"[A-Z]" segment) (re-find #"[0-9]" segment)))
         (str/split s #"[_-]"))))

(def structured-key
  (re-pattern (str "(?i)(?:" (entry-key "name") "(?:" quote-pattern ")?" secret-key-pattern "(?:" quote-pattern ")?" entry-gap "(?:" quote-pattern ")?" (entry-key "value")
                   "|(?<![\\w-])--?" secret-key-pattern "[ \\t]+"
                   "|[\\\"']?" secret-key-pattern "(?:" quote-pattern ")?" gap-pattern "(?:[:=]|\\\\+u00(?:3[aA]|3[dD]))" gap-pattern ")")))
(def entry-value (re-pattern (str "(?i)" (entry-key "value") "(?=[\\[{(])")))
(def entry-name-after (re-pattern (str "(?i)(?:" quote-pattern ")?" entry-gap "(?:" quote-pattern ")?" (entry-key "name") "(?:" quote-pattern ")?" secret-key-pattern)))
(def structure-token (re-pattern (str quote-pattern "|[\\[\\]{}()]")))
(def line-break #"\r?\n|\\+(?:r\\+)?n")
(def gap-at-end (re-pattern (str gap-pattern "\\z")))
(def closers {\[ \] \{ \} \( \)})
(def max-reversed-entries 1000)
(def max-reversed-value 4096)

(defn closes-quote? [token opening]
  (let [trim #(str/replace % #"^\\+" "")
        depth (- (count opening) (count (trim opening)))
        token-depth (- (count token) (count (trim token)))]
    (and (= (trim token) (trim opening))
         (zero? (mod (- token-depth depth) (* 2 (inc depth)))))))

(defn bracket-end [text start stop]
  (let [stop (min (count text) stop) opener (.charAt text start) closer (closers opener)
        matcher (.matcher structure-token text)]
    (.region matcher start stop)
    (loop [depth 0 quote nil]
      (if (.find matcher)
        (let [token (.group matcher) c (when (= 1 (count token)) (.charAt token 0))]
          (cond quote (recur depth (when-not (closes-quote? token quote) quote))
                (= c opener) (recur (inc depth) nil)
                (= c closer) (if (= depth 1) (.end matcher) (recur (dec depth) nil))
                (contains? #{\[ \] \{ \} \( \)} c) (recur depth nil)
                :else (recur depth token)))
        stop))))

(defn block-end [text key-end]
  (let [m (.matcher line-break text) start (max 0 (- key-end 256))
        line-start (loop [pos start last-start start]
                     (if (and (.find m pos) (< (.start m) key-end) (<= (.end m) key-end))
                       (recur (.end m) (.end m)) last-start))
        head (subs text line-start key-end)
        indent (- (count head) (count (str/replace head #"^[ \t]+" "")))]
    (loop [end key-end position key-end]
      (if (.find m position)
        (let [begin (.end m) has-next (.find m begin) next-start (if has-next (.start m) (count text))
              line (subs text begin next-start) body (str/replace line #"^[ \t]+" "") column (- (count line) (count body))]
          (cond (str/blank? body) (if has-next (recur end next-start) end)
                (or (< column indent) (and (= column indent) (not (re-find #"^-(?:\s|$)" body)))) end
                :else (recur next-start next-start)))
        end))))

(defn structured-end [text matcher]
  (let [start (.start matcher) end (.end matcher)]
    (when (< end (count text))
      (if (contains? closers (.charAt text end))
        (bracket-end text end (count text))
        (let [gap (.matcher gap-at-end text) _ (.region gap start end)
              key-end (if (.find gap) (.start gap) end)
              breaks (.matcher line-break text) _ (.region breaks key-end end)]
          (when (.find breaks)
            (let [block (block-end text key-end)] (when (> block key-end) block))))))))

(defn mask-reversed-entries [text mark]
  (let [matcher (.matcher entry-value text) out (StringBuilder.)]
    (loop [position 0 scanned 0]
      (if (.find matcher)
        (do
          (when (>= scanned max-reversed-entries) (throw (ex-info "too many entries" {})))
          (if (< (.start matcher) position)
            (recur position (inc scanned))
            (let [end (bracket-end text (.end matcher) (+ (.end matcher) max-reversed-value))
                  after (.matcher entry-name-after text) _ (.region after end (count text))]
              (if (.lookingAt after)
                (do (.append out (subs text position (.start matcher))) (.append out (mark :env-entry))
                    (recur end (inc scanned)))
                (recur position (inc scanned))))))
        (do (.append out (subs text position)) (str out))))))

(defn mask-structured [text mark]
  (let [matcher (.matcher structured-key text) out (StringBuilder.)]
    (loop [position 0]
      (if (.find matcher position)
        (let [end (structured-end text matcher)]
          (if end
            (do (.append out (subs text position (.start matcher))) (.append out (mark :assignment)) (recur end))
            (do (.append out (subs text position (.end matcher))) (recur (max (.end matcher) (inc position))))))
        (do (.append out (subs text position)) (mask-reversed-entries (str out) mark))))))

(def loose-word (re-pattern "(?i)(?:password|passwd|passphrase|pwd|secret|token(?!s(?![a-z])|_?count)|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie|authorization|(?<![a-z])pass(?![a-z])|(?<![a-z])auth(?![a-z])|パスワード|暗証番号|秘密鍵|認証情報|トークン|シークレット|合言葉)"))
(def placeholder #"\[REDACTED:[a-z_-]+\]")
(def segment-break #"\r?\n|\\+(?:r\\+)?n|[。！？]")
(def secret-element (re-pattern (str "(?is)(?:<|&lt;|&#0*60;|&#x0*3c;|\\\\+u003c)(?<tag>[\\w:.-]{0,64}" (.pattern loose-word) "[\\w:.-]{0,64})(?=[\\s/>&\\\\])(?!(?:(?!(?:>|&gt;|&#0*62;|&#x0*3e;|\\\\+u003e)).){0,512}?[/\\\\]\\s*(?:>|&gt;|&#0*62;|&#x0*3e;|\\\\+u003e)).*?(?:(?:<|&lt;|&#0*60;|&#x0*3c;|\\\\+u003c)\\\\*/\\k<tag>\\s*(?:>|&gt;|&#0*62;|&#x0*3e;|\\\\+u003e)|\\z)")))

(defn mask-secret-lines [text mark]
  (let [matcher (.matcher segment-break text)
        parts (loop [pos 0 out []]
                (if (.find matcher)
                  (recur (.end matcher) (conj out (subs text pos (.start matcher)) (.group matcher)))
                  (conj out (subs text pos))))
        filled (vec (filter #(not (str/blank? (nth parts %))) (range 0 (count parts) 2)))
        hits (set (keep-indexed (fn [i p] (when (or (str/includes? (nth parts p) "ZZMASKHITZZ") (re-find loose-word (str/replace (nth parts p) placeholder ""))) i)) filled))
        masked (set (mapcat (fn [i] (keep #(get filled %) [(dec i) i (inc i)])) hits))]
    (apply str (map-indexed (fn [i part] (if (contains? masked i) (mark :secret_line) part)) parts))))

(defn redact
  "Mask known secret forms and environment values. On any error, drop the field."
  [s values]
  (try
    (let [counts (atom {})
          mark (fn [kind] (swap! counts update kind (fnil inc 0)) (str "[REDACTED:" (name kind) "]"))
          with-values (if-let [pattern (values-pattern (vec values))]
                        (str/replace (str s) pattern (fn [_] (mark :env)))
                        (str s))
          masked (mask-secret-lines (reduce (fn [text [kind pattern]]
                           (str/replace text pattern
                                        (fn [match]
                                          (let [m (if (vector? match) (first match) match)]
                                            (if (and (= kind :entropy) (not (entropy-secret? m))) m (str (when (re-find loose-word m) "ZZMASKHITZZ") (mark kind)))))))
                         (mask-structured (str/replace with-values secret-element (fn [_] (mark :element))) (fn [kind] (str "ZZMASKHITZZ" (mark kind)))) patterns) mark)]
      {:value masked :redactions @counts})
    (catch Throwable _ {:value "[dropped: redaction error]" :redactions {:error 1}})))

(def sensitive-path
  #"(?i)(?:^|[/\\\s\"'=])(?:auth\.json|\.credentials[^/\s\"']*|\.env[^/\s\"']*|\.ssh(?:[/\\]|\b)|\.aws(?:[/\\]|\b)|kubeconfig|\.kube[/\\]config|\.git-credentials|\.netrc|id_rsa|id_ed25519(?:_sk)?|id_dsa|id_ecdsa(?:_sk)?|\.gnupg(?:[/\\]|\b)|secrets?(?:[/\\]|(?=$|[\s\"']))|[\w.-]{0,64}tokens?[\w.-]{0,64}\.[a-z0-9]{1,8}(?![\w.-])|[\w.-]{0,64}\.(?:key|pem|p8|p12|pfx|jks|keystore|ppk)(?![\w.-])|\.npmrc|\.pypirc|\.pgpass|\.my\.cnf|\.docker[/\\]config\.json|\.boto|\.s3cfg|\.vault-token|\.terraformrc|\.htpasswd|\.config[/\\]gh[/\\]hosts\.yml|\.config[/\\]gcloud(?:[/\\]|\b)|\.azure(?:[/\\]|\b)|\.cargo[/\\]credentials[^/\s\"']*|\.gem[/\\]credentials)|[/\\][\w.-]{0,64}tokens?[\w.-]{0,64}(?=[/\\\s\"']|$)|(?:^|[\s\"'=])(?:[\w.-]{0,64}token|[\w.-]{0,64}tokens[\w.-]{1,64})(?![\w.-])")
;; The last alternative is a token file named without an extension or a directory: mytoken, access_token,
;; refresh_tokens_backup. A bare plural (input_tokens, max_output_tokens, "count tokens") is a counter word, not a file.
(def sensitive-command
  #"(?i)(?:^|[;&|\s\"'(`/]|\\[nrt])(?:env|printenv)(?:[\s\"'|;&<>)]|$)|(?:^|[;&|\s\"'(`/])(?:set|export|declare|typeset)(?:\s+-[a-z]*[px]\b|[ \t]*(?:$|[|;&<>\"')`#]|\\[nrt\"]))|\benviron\b|\bprocess\.env\b|\bgetenv\b|\baws\b[^|;&\n]{0,512}\b(?:ssm\s+get-parameter|secretsmanager\s+get-|configure\s+(?:get|export-credentials)|sts\s+(?:get-session-token|assume-role\S*|get-federation-token)|ecr\s+get-login-password|iam\s+create-access-key)|\bgcloud\b[^|;&\n]{0,512}\b(?:auth\s+(?:print-(?:access|identity)-token|application-default\s+print-access-token)|secrets\s+versions\s+access)|\baz\b[^|;&\n]{0,512}\b(?:account\s+get-access-token|keyvault\s+secret\s+show)|\bkubectl\b[^|;&\n]{0,512}\bcreate\s+token\b|\boc\s+whoami\s+-t\b|\bvault\s+(?:read|kv\s+get|token\s+(?:create|lookup)|login)\b|\bop\s+(?:read|item\s+get)\b|\bdocker-credential-\w+|\bhelm\s+get\b|\bgh\s+auth\s+token\b|\bgit\s+credential\b")
(defn withhold-output? [input]
  (let [s (str input)] (boolean (or (re-find sensitive-path s) (re-find sensitive-command s)
                                    (and (re-find #"(?i)\b(?:kubectl|oc)\s" s) (re-find #"(?i)secret" s))))))
(defn env-dump? [output]
  (let [s (str output)] (boolean (and (re-find #"(?:^|[^A-Za-z0-9_])PATH=" s)
                                        (re-find #"(?:^|[^A-Za-z0-9_])HOME=" s)))))

(defn guard-safe?
  "Scan again instead of relying on the per-field pass."
  [text values]
  (let [result (redact (str/replace text placeholder "") values)]
    (and (not= "[dropped: redaction error]" (:value result))
         (empty? (:redactions result))
         (not (re-find loose-word (str/replace text placeholder ""))))))

;; The pass that runs on every field. Rebound in tests to prove the final guard catches a miss.
(def ^:dynamic *redact-field* redact)

;; ------------------------------------------------------------------- config

(defn- env-long [env k default]
  (try (Long/parseLong (get env k "")) (catch Exception _ default)))

(defn config [env]
  (let [root (fs/path (get env "CODEX_TASK_BOARD_ROOT" (str (fs/home) "/.codex-task-board")))
        dir (fs/path root "langfuse-exporter")]
    {:root root
     :dir dir
     :spool (fs/path dir "spool")
     :state-file (fs/path dir "state.edn")
     :metrics-file (fs/path dir "metrics.prom")
     :claude-projects (fs/path (get env "CLAUDE_HOME" (str (fs/home) "/.claude")) "projects")
     :codex-sessions (fs/path (get env "CODEX_HOME" (str (fs/home) "/.codex")) "sessions")
     :url (str/replace (get env "LANGFUSE_URL" "http://langfuse-web.langfuse.svc.cluster.local:3000") #"/+$" "")
     :public-key (get env "LANGFUSE_PUBLIC_KEY")
     :secret-key (get env "LANGFUSE_SECRET_KEY")
     :secret-values (secret-values env)
     :max-field-bytes (env-long env "LANGFUSE_MAX_FIELD_BYTES" 32768)
     :max-spans (env-long env "LANGFUSE_MAX_SPANS_PER_RUN" 2000)
     :max-run-bytes (env-long env "LANGFUSE_MAX_RUN_BYTES" (* 16 1024 1024))
     :max-batch-bytes (* 2 1024 1024)
     :max-log-bytes (* 256 1024 1024)
     :spool-max-bytes (env-long env "LANGFUSE_SPOOL_MAX_BYTES" (* 256 1024 1024))
     :spool-ttl-ms (* 3 86400000)
     :max-attempts (env-long env "LANGFUSE_MAX_ATTEMPTS" 20)
     :max-runs-per-tick (env-long env "LANGFUSE_MAX_RUNS_PER_TICK" 5)
     :max-age-ms (* 7 86400000)
     :marker-keep-ms (* 30 86400000)
     :terminal-settle-ms 60000
     :connect-timeout-ms 3000
     :request-timeout-ms 15000
     :batch-pause-ms 200
     :backoff-base-ms 5000
     :backoff-max-ms 300000}))

;; ---------------------------------------------------------------- utilities

(defn- sha256-hex [s]
  (let [d (.digest (java.security.MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))]
    (apply str (map #(format "%02x" (bit-and % 0xff)) d))))

(defn trace-id [ticket run] (subs (sha256-hex (str "task-board:" ticket ":" run)) 0 32))
(defn span-id [tid k] (subs (sha256-hex (str tid k)) 0 16))

(defn- ->millis [ts]
  (try (.toEpochMilli (java.time.Instant/parse (str ts))) (catch Exception _ nil)))

(defn run-started-ms
  "Run ids start with their UTC start time, which summary.edn does not always carry."
  [run]
  (try
    (let [fmt (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")]
      (-> (java.time.LocalDateTime/parse (subs run 0 16) fmt)
          (.toInstant java.time.ZoneOffset/UTC)
          .toEpochMilli))
    (catch Exception _ nil)))

(defn- bytes-of [^String s] (alength (.getBytes s "UTF-8")))

(defn truncate-field [^String s max-bytes]
  (let [b (.getBytes s "UTF-8")]
    (if (<= (alength b) max-bytes)
      s
      (str (String. b 0 (int max-bytes) "UTF-8") "…[truncated " (- (alength b) max-bytes) " bytes]"))))

(defn read-jsonl
  "Malformed lines are skipped: a partial last line must not lose the whole log."
  [path]
  (with-open [r (java.io.BufferedReader. (java.io.FileReader. (str path)))]
    (doall (keep (fn [line] (try (json/parse-string line true) (catch Exception _ nil)))
                 (line-seq r)))))

(defn- safe-slurp [path] (when (fs/exists? path) (try (slurp (str path)) (catch Exception _ nil))))

(defn content-text
  "Images and binary blocks never leave as bytes. Thinking and reasoning are never included."
  [content]
  (cond
    (string? content) content
    (sequential? content)
    (str/join "\n"
              (keep (fn [block]
                      (if-not (map? block)
                        (str block)
                        (case (str (:type block))
                          ("text" "input_text" "output_text") (:text block)
                          ("image" "input_image" "image_url" "document" "audio" "input_audio") "[image omitted]"
                          "tool_result" (str "[tool_result " (:tool_use_id block) "]")
                          ("thinking" "redacted_thinking" "reasoning" "tool_use") nil
                          (str "[" (:type block) " omitted]"))))
                    content))
    (nil? content) ""
    :else (json/generate-string content)))

;; --------------------------------------------------------------- trace model

(defn- attr [k v]
  {:key k
   :value (cond
            (sequential? v) {:arrayValue {:values (mapv (fn [x] {:stringValue (str x)}) v)}}
            (boolean? v) {:boolValue v}
            (integer? v) {:intValue (str v)}
            :else {:stringValue (str v)})})

(defn- attrs [m] (mapv (fn [[k v]] (attr k v)) m))

(defn- nanos [ms] (str (* (long ms) 1000000)))

(defn- mk-span
  [{:keys [tid trace-attrs]} {:keys [key parent name start end attrs-map level]}]
  (let [start (or start 0)
        end (max start (or end start))]
    (cond-> {:traceId tid
             :spanId (span-id tid key)
             :name name
             :kind 1
             :startTimeUnixNano (nanos start)
             :endTimeUnixNano (nanos end)
             :attributes (into (attrs trace-attrs) (attrs attrs-map))}
      parent (assoc :parentSpanId (span-id tid parent))
      (= level "ERROR") (assoc :status {:code 2}))))

;; Values that a name-based known format named (password: x, --token x, -u user:x, env entries). Masking them only
;; in place leaves a bare restatement elsewhere in the run readable, so the exporter masks the same value in every
;; field of the run (exact text and its serialized escapes; other transforms are the accepted residual,
;; THREAT_MODEL 2). A value too short to mask without blanking ordinary words, or too long or too many to mask,
;; is unpinned: in a tool result it withholds the later bodies of the lineage.
(def pin-kinds #{:env-entry :flag :cli-password :assignment})
(def min-pinned-length 4)
(def max-pinned-length 256)
(def max-pinned-values 64)
(def name-separator #"(?s)^(.*?)(?:[:=]|\\+u00(?:3[aA]|3[dD]))")

(def ^:private opening-quote (re-pattern (str "(?i)^" quote-pattern)))
(def ^:private unquoted-value
  #"(?i)^(?:[^\s,;}\]\"'\\&]|\\\\|\\(?![nrt\"']|u00(?:22|27))|&(?!quot|apos|#0*(?:34|39)(?!\d)|#x0*(?:22|27)(?![0-9a-fA-F])))++")

(defn- first-value
  "The value at the start of s: up to the matching quote when quoted, else up to a delimiter."
  [s]
  (let [s (str/triml (str s))]
    ;; Quotes include their serialized forms (\", \u0022, &quot;, &#34;, &#x22;, &apos;), matched as the in-place
    ;; mask (quote-pattern) matches them: the value ends at the same quote token.
    (if-let [q (re-find opening-quote s)]
      (let [body (subs s (count q))
            ;; Like the in-place mask ((?<!\\)\k<quote>), a quote token preceded by a backslash is escaped and does
            ;; not end the value: password: "a\"b" captures a\"b (and its decoded form a"b), not a\.
            closer (re-matcher (java.util.regex.Pattern/compile (str "(?<!\\\\)" (java.util.regex.Pattern/quote q))
                                                                java.util.regex.Pattern/CASE_INSENSITIVE) body)]
        (if (.find closer) (subs body 0 (.start closer)) body))
      ;; Unquoted: stop at a quote, an entity quote or a quote/line escape (\", \u0022, \n, \r, \t) too, so a value
      ;; inside serialized JSON or HTML does not take the closing quote or a \n escape with it. Any other backslash
      ;; (password: \mysecret123, its JSON form \\mysecret123, my\secret) is part of the value, not its end.
      (or (re-find unquoted-value s) ""))))

(defn- reference? [v]
  (boolean (re-matches #"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\[REDACTED:[a-z_-]+\]" v)))

;; A list or object value (password: [a, b], token: {primary: a}) is masked in place as a whole (mask-structured);
;; each element is pinned too. Quoted elements keep their commas; a key followed by : or = names, not a value.
(def ^:private collection-gap #"^(?:[\s,;\[\]{}()]++|\\++[nrt](?![A-Za-z0-9]))++")

(defn- collection-values [s]
  (let [object? (str/starts-with? (str/triml s) "{")]
    (loop [s s acc [] n 0]
      (let [s (str/replace-first s collection-gap "")]
        ;; More than max-pinned-values elements already unpins the value; stop scanning there. Past 256 tokens
        ;; (mostly keys) the rest is returned as one value, which unpins it when long (fail closed).
        (cond
          (or (str/blank? s) (> (count acc) max-pinned-values)) acc
          (> n 256) (conj acc s)
          :else
          (let [q (re-find opening-quote s)
                v (first-value s)
                v (if q v (first (str/split v #"[\[\]{}()]" 2)))
                consumed (cond (not q) (count v)
                               (> (count s) (+ (count q) (count v))) (+ (count q) (count v) (count q))
                               :else (count s))
                consumed (max 1 (min consumed (count s)))
                after (subs s consumed)
                key? (or (re-find #"^\s*(?:[:=]|\\+u00(?:3[aA]|3[dD]))" after)
                         (and (not q) (re-find #"[:=]$" v)))
                after (if (and key? (not (re-find #"[:=]$" (str v)))) (str/replace-first after #"^\s*(?:[:=]|\\+u00(?:3[aA]|3[dD]))" "") after)
                v (if (and (not q) (not key?) object?) (or (second (re-find #"^[\w.-]+[:=](.+)$" v)) v) v)]
            (recur after (if (or key? (str/blank? v)) acc (conj acc v)) (inc n))))))))

(def ^:private env-value-key (re-pattern (str "(?i)" key-start "value(?:" quote-pattern ")?" gap-pattern "[:=]" gap-pattern)))

(defn- match-values [kind m]
  (case kind
    :assignment (let [[head key] (re-find name-separator m)
                      tail (subs m (count head))
                      key (str/replace (str key) #"[\"'\\\s]" "")]
                  (cond (re-find #"^\s*[|>]" tail) (map str/trim (rest (str/split tail #"\r?\n|\\+n")))
                        (re-find #"^\s*[\[{(]" tail) (collection-values tail)
                        :else (let [v (first-value tail)] (when-not (setting? key v) [v]))))
    :flag [(first-value (str/replace-first m #"^\S+[ \t]+" ""))]
    :cli-password (if (re-find #"(?i)^(?:-u|--user)" m)
                    (let [rest (str/replace-first m #"(?i)^(?:-u|--user)[ \t=]*" "")]
                      (if (re-find opening-quote rest)
                        ;; -u 'user:pass word': the whole quoted word is user:password.
                        (let [w (first-value rest) i (str/index-of w ":")] (when i [(subs w (inc i))]))
                        [(first-value (str/replace-first rest #"^[^\s:]+:" ""))]))
                    [(first-value (str/replace-first m #"(?is)^.*?\s-p[ \t]*" ""))])
    ;; The value key takes every serialized quote form (&quot;value&quot;:, \u0022value\u0022:), as entry-key does.
    :env-entry (let [matcher (re-matcher env-value-key m)]
                 (when (.find matcher) [(first-value (subs m (.end matcher)))]))
    nil))

(def ^:private tag-close #"(?i)>|&gt;|&#0*62;|&#x0*3e;|\\+u003e")
(def ^:private element-split
  #"(?i)(?:<|&lt;|&#0*60;|&#x0*3c;|\\+u003c)[^<>&\\]{0,256}?(?:>|&gt;|&#0*62;|&#x0*3e;|\\+u003e)|\r?\n|\\+[nrt]")

(defn- element-values
  "Text values inside an XML element whose tag names a secret (<password>x</password>, encoded forms too). The
  element is masked in place; its text is pinned like an assignment value so a bare restatement is masked too.
  Nested child tags and line breaks separate values. A self-closing tag names nothing: secret-element does not
  start a match at one (so <password/><password>x</password> yields the second element); an opening tag longer than
  that lookahead's 512 characters is treated as an element (fail closed)."
  [m]
  (let [closer (re-matcher tag-close m)]
    (when (.find closer)
      (let [open-tag (subs m 0 (.start closer))]
        (if (and (<= (count open-tag) 512) (re-find #"[/\\]\s*$" open-tag))
          nil
          (let [inner (subs m (.end closer))
                inner (if-let [c (re-find #"(?is)^(.*)(?:<|&lt;|&#0*60;|&#x0*3c;|\\+u003c)\\*/[\w:.-]+\s*(?:>|&gt;|&#0*62;|&#x0*3e;|\\+u003e)$" inner)]
                        (second c) inner)]
            (for [segment (str/split inner element-split)
                  :let [v (-> segment str/trim (str/replace #"^(?:\\*[\"'])+|(?:\\*[\"'])+$" "") str/trim)]
                  :when (not (str/blank? v))]
              v)))))))

;; A value captured from a serialized body keeps its escapes (password: &quot;a&amp;b&quot; captures a&amp;b), while
;; a later restatement can be the decoded text (a&b). Both are pinned: the decoded form is matched with its own
;; escapes by value-pattern, so pinning it covers the plain restatement and every serialization of it.
(def ^:private entity-escape #"&(?:#0*(\d{1,7})|#[xX]0*([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));")
(def ^:private json-escape #"\\(?:u([0-9a-fA-F]{4})|([\"'\\/bfnrt]))")

(defn- code-point-str [n]
  (when (and n (<= 1 n 0x10FFFF)) (String. (Character/toChars (int n)))))

(defn- decode-once [v]
  (-> v
      (str/replace entity-escape
                   (fn [[m dec hex named]]
                     (or (cond dec (code-point-str (parse-long dec))
                               hex (code-point-str (Long/parseLong hex 16))
                               :else ({"amp" "&" "lt" "<" "gt" ">" "quot" "\"" "apos" "'"} named))
                         m)))
      (str/replace json-escape
                   (fn [[m hex c]]
                     (or (if hex
                           (str (char (Integer/parseInt hex 16)))
                           ({"\"" "\"" "'" "'" "\\" "\\" "/" "/" "b" "\b" "f" "\f" "n" "\n" "r" "\r" "t" "\t"} c))
                         m)))))

(defn- decoded-forms
  "v and its decoded forms (HTML entities and JSON escapes, up to 3 nested layers)."
  [v]
  (loop [v v acc [v] n 0]
    (let [d (decode-once v)]
      (if (or (= d v) (>= n 3)) acc (recur d (conj acc d) (inc n))))))

(defn- assignment-matches
  "Assignment matches in text; one whose value opens a bracket extends to the matching close (or the end of text,
  fail closed), as mask-structured masks it."
  [pattern text]
  (let [m (re-matcher pattern text) n (count text)]
    ;; A match inside an extended value is already covered by it (its elements are scanned there); skipping it
    ;; keeps unclosed brackets (password: [password: [ ...) linear.
    (loop [acc [] covered 0]
      (if (.find m)
        (if (< (.start m) covered)
          (recur acc covered)
        (let [s (.group m)
              head (first (re-find name-separator s))
              pos (loop [p (+ (.start m) (count head))]
                    (if (and (< p n) (#{\space \tab} (.charAt text p))) (recur (inc p)) p))]
          (if (and head (< pos n) (contains? closers (.charAt text pos)))
            (let [end (max (.end m) (bracket-end text pos n))]
              (recur (conj acc (subs text (.start m) end)) end))
            (recur (conj acc s) covered))))
        acc))))

(defn named-values
  "{:values [...] :unpinned? bool} for the name-based known formats in text."
  [text]
  (let [text (str text)
        found (concat
               (for [[kind pattern] patterns :when (pin-kinds kind)
                     match (if (= kind :assignment) (assignment-matches pattern text) (re-seq pattern text))
                     v (match-values kind (if (vector? match) (first match) match))
                     :let [v (str/trim (str v))]
                     :when (and (not (str/blank? v)) (not (reference? v)))]
                 v)
               (for [match (re-seq secret-element text)
                     v (element-values (if (vector? match) (first match) match))
                     :when (not (reference? v))]
                 v))
        found (distinct (mapcat decoded-forms found))
        unpinned? (boolean (or (some #(< (count %) min-pinned-length) found)
                               (some #(> (count %) max-pinned-length) found)
                               (> (count found) max-pinned-values)))]
    {:values (vec (filter #(<= min-pinned-length (count %) max-pinned-length) found)) :unpinned? unpinned?}))

(def withheld-model-output "[withheld: the session saw a known source or a known format]")
(def withheld-tool-output "[withheld: sensitive path or command]")
(def ^:dynamic *exposure-values* [])

;; Kinds whose value is a credential by its own shape. A hit of one of these in a tool result withholds the
;; later bodies of the lineage. Name-based kinds (assignment, env entry, flag, cli password, XML element) mask
;; the value in place and pin it for the run (named-values): they also match ordinary code and logs such as TOKEN_FILE=/work/x or
;; credentials: 'same-origin', and a transformed restatement elsewhere is the accepted residual (THREAT_MODEL 2).
(def lineage-kinds #{:private-key :header :url-credentials :jwt :provider-key :aws-key :google-key :telegram :bearer})

(defn- exposure? [output]
  (let [text (str output)]
    (or (some #(str/includes? text %) *exposure-values*)
        (some (fn [[kind pattern]] (when (contains? lineage-kinds kind) (re-find pattern text))) patterns)
        (:unpinned? (named-values text)))))

(defn- tool-reason [tool result]
  (try
    (cond (withhold-output? (:input tool)) "known_source"
          (> (bytes-of (str (:output result))) (* 1024 1024)) "unscanned_output"
          (env-dump? (:output result)) "env_dump"
          (exposure? (:output result)) "known_format_in_tool_output")
    (catch Throwable _ "unscanned_output")))

(defn- tool-span [ctx {:keys [key parent name start end input output error? status policy]}]
  (mk-span ctx {:key key :parent parent :name (str "tool:" name) :start start :end end
                :level (when error? "ERROR")
                :attrs-map (cond-> {"langfuse.observation.type" "tool"
                                    "langfuse.observation.input" (if (string? input) input (json/generate-string input))
                                    "langfuse.observation.output" (str (or output ""))
                                    "langfuse.observation.metadata.body_policy" (or policy "sent")}
                             status (assoc "langfuse.observation.metadata.status" status)
                             error? (assoc "langfuse.observation.level" "ERROR"))}))

(defn- generation-span [ctx {:keys [key parent model usage start end input output policy]}]
  (mk-span ctx {:key key :parent parent :name (str "generation:" (or model "unknown")) :start start :end end
                :attrs-map (cond-> {"langfuse.observation.type" "generation"
                                    "langfuse.observation.input" input
                                    "langfuse.observation.output" output
                                    "langfuse.observation.metadata.input_scope" "delta"
                                    "langfuse.observation.metadata.body_policy" (or policy "sent")}
                             model (assoc "langfuse.observation.model.name" model)
                             (seq usage) (assoc "langfuse.observation.usage_details" (json/generate-string usage)))}))

(defn system-prompt-span [ctx {:keys [parent hash text ts]}]
  (mk-span ctx {:key (str "system:" hash) :parent parent :name "cli-system-prompt" :start ts :end ts
                :attrs-map {"langfuse.observation.type" "span"
                            "langfuse.observation.input" text
                            "langfuse.observation.metadata.source" "cli_internal"}}))

;; Claude Code session lines. One API message spans several lines sharing message.id.

(defn claude-usage [{:keys [input_tokens output_tokens cache_read_input_tokens cache_creation_input_tokens]}]
  (cond-> {}
    input_tokens (assoc :input input_tokens)
    output_tokens (assoc :output output_tokens)
    cache_read_input_tokens (assoc :cache_read_input_tokens cache_read_input_tokens)
    cache_creation_input_tokens (assoc :cache_creation_input_tokens cache_creation_input_tokens)))

(defn- claude-results [lines]
  (into {}
        (for [line lines
              :when (= "user" (:type line))
              :let [content (get-in line [:message :content])]
              :when (sequential? content)
              block content
              :when (= "tool_result" (:type block))]
          [(:tool_use_id block) {:output (content-text (:content block))
                                 :error? (true? (:is_error block))
                                 :ts (->millis (:timestamp line))}])))

(defn- claude-pending-entry [line]
  (case (:type line)
    "user" (content-text (get-in line [:message :content]))
    "attachment" (json/generate-string (:attachment line))
    nil))

(defn claude-generations
  "Group assistant lines by message id. :input holds what arrived since the previous one."
  [lines]
  (let [{:keys [gens]}
        (reduce
         (fn [{:keys [pending gens] :as acc} line]
           (if (= "assistant" (:type line))
             (let [msg (:message line)
                   same? (and (seq gens) (= (:id (peek gens)) (:id msg)))
                   gen (if same?
                         (peek gens)
                         {:id (:id msg) :input (str/join "\n" pending) :ts (->millis (:timestamp line)) :blocks []})
                   gen (-> gen
                           (assoc :model (:model msg) :usage (:usage msg))
                           (update :blocks into (:content msg)))]
               {:pending [] :gens (conj (if same? (pop gens) gens) gen)})
             (if-let [entry (claude-pending-entry line)]
               (assoc acc :pending (conj pending entry))
               acc)))
         {:pending [] :gens []}
         lines)]
    gens))

(declare codex-usage)
(defn- session-spans [ctx parent prefix gens results format end-of-log]
  (let [tools-of (fn [gen] (if (= format :claude) (filter #(= "tool_use" (:type %)) (:blocks gen)) (:tools gen)))
        tool-id (if (= format :claude) :id :call-id)
        reason-of (fn [tool] (tool-reason tool (get results (tool-id tool))))
        first-hit (first (keep-indexed (fn [i gen] (when-let [reason (some reason-of (tools-of gen))] [i reason])) gens))]
    (mapcat
     (fn [gen next-gen idx]
       (let [gen-key (str prefix "gen:" idx) tools (tools-of gen)
             end (or (:ts next-gen) end-of-log (:ts gen))
             later? (and first-hit (> idx (first first-hit)))
             output (if (= format :claude) (content-text (:blocks gen)) (str/join "\n" (:text gen)))
             output (str/trim (str/join "\n" (cons output (map #(str "[tool_use " (:name %) "]") tools))))]
         (cons
          (generation-span ctx {:key gen-key :parent parent :model (:model gen)
                                :usage ((if (= format :claude) claude-usage codex-usage) (:usage gen))
                                :start (:ts gen) :end end :input (if later? withheld-model-output (:input gen))
                                :output (if later? withheld-model-output output)
                                :policy (when later? (str "withheld_after_" (second first-hit)))})
          (map-indexed (fn [tool-idx tool]
                 (let [result (get results (tool-id tool)) reason (reason-of tool)
                       prior (or (when later? (second first-hit)) (some reason-of (take tool-idx tools)))
                       policy (cond (and reason (not= reason "known_format_in_tool_output")) (str "withheld_" reason)
                                    prior (str "withheld_after_" prior)
                                    (= reason "known_format_in_tool_output") "masked_known_format"
                                    :else "sent")
                       withheld? (and reason (not= reason "known_format_in_tool_output"))
                       body (cond withheld? withheld-tool-output prior withheld-model-output)]
                   (tool-span ctx {:key (str gen-key ":tool:" (tool-id tool)) :parent gen-key :name (:name tool)
                                   :start (or (:ts tool) (:ts gen)) :end (or (:ts result) end)
                                   :input (or body (:input tool)) :output (or body (:output result))
                                   :policy policy :status (:status tool) :error? (or (:error? tool) (:error? result))}))) tools))))
     gens (concat (rest gens) [nil]) (range))))

(defn claude-spans [ctx parent prefix lines]
  (session-spans ctx parent prefix (claude-generations lines) (claude-results lines) :claude
                 (some ->millis (reverse (map :timestamp lines)))))

(defn- claude-system-prompts [lines]
  (for [line lines
        :when (and (= "api-request-blob" (:type line))
                   (= "system" (get-in line [:message :role])))]
    {:hash (:hash line) :text (content-text (get-in line [:message :content])) :ts nil}))

;; Codex rollout lines.

(defn codex-usage
  "Codex reports cached tokens inside input and reasoning inside output. Split them so that
  Langfuse, which sums the buckets, does not double count."
  [{:keys [input_tokens cached_input_tokens cache_write_input_tokens output_tokens reasoning_output_tokens]}]
  (let [cached (or cached_input_tokens 0)
        write (or cache_write_input_tokens 0)
        reasoning (or reasoning_output_tokens 0)]
    (cond-> {}
      input_tokens (assoc :input (max 0 (- input_tokens cached write)))
      output_tokens (assoc :output (max 0 (- output_tokens reasoning)))
      (pos? cached) (assoc :input_cached_tokens cached)
      (pos? write) (assoc :input_cache_write_tokens write)
      (pos? reasoning) (assoc :output_reasoning_tokens reasoning))))

(defn- codex-tool-input [payload]
  (or (:arguments payload) (:input payload) ""))

(defn codex-generations [lines]
  (let [close (fn [{:keys [open gens] :as acc}]
                (if open (assoc acc :gens (conj gens open) :open nil) acc))
        ensure-open (fn [{:keys [open pending model] :as acc} ts]
                      (if open
                        acc
                        (assoc acc :open {:input (str/join "\n" pending) :ts ts :model model :text [] :tools []}
                               :pending [])))
        step
        (fn [acc line]
          (let [p (:payload line)
                ts (->millis (:timestamp line))]
            (case (:type line)
              "turn_context" (assoc acc :model (:model p))
              "event_msg"
              (if (= "token_count" (:type p))
                (let [usage (get-in p [:info :last_token_usage])
                      acc (close acc)]
                  (if (and usage (seq (:gens acc)) (nil? (:usage (peek (:gens acc)))))
                    (update acc :gens (fn [gens] (conj (pop gens) (assoc (peek gens) :usage usage))))
                    acc))
                acc)
              "response_item"
              (case (:type p)
                "message"
                (if (= "assistant" (:role p))
                  (update-in (ensure-open acc ts) [:open :text] conj (content-text (:content p)))
                  (update (close acc) :pending conj (str "[" (:role p) "]\n" (content-text (:content p)))))
                ("function_call" "custom_tool_call")
                (update-in (ensure-open acc ts) [:open :tools] conj
                           {:call-id (:call_id p) :name (:name p) :input (codex-tool-input p) :ts ts
                            :status (:status p) :error? (and (:status p) (not= "completed" (:status p)))})
                ("function_call_output" "custom_tool_call_output")
                (-> (close acc)
                    (assoc-in [:results (:call_id p)] {:output (content-text (:output p)) :ts ts})
                    (update :pending conj (str "[tool_result " (:call_id p) "]")))
                acc)
              acc)))
        result (close (reduce step {:pending [] :gens [] :results {} :open nil :model nil} lines))]
    (select-keys result [:gens :results])))

(defn codex-spans [ctx parent prefix lines]
  (let [{:keys [gens results]} (codex-generations lines)]
    (session-spans ctx parent prefix gens results :codex (some ->millis (reverse (map :timestamp lines))))))

(defn- codex-system-prompts [lines]
  (for [line lines
        :when (= "session_meta" (:type line))
        :let [text (get-in line [:payload :base_instructions])
              text (if (map? text) (:text text) text)]
        :when (string? text)]
    {:hash (sha256-hex text) :text text :ts (->millis (:timestamp line))}))

(defn- lines-span-range [lines]
  (let [ts (keep (comp ->millis :timestamp) lines)]
    (when (seq ts) [(apply min ts) (apply max ts)])))

;; Locating logs.

(defn claude-project-dir [cfg ticket run]
  (let [workspace (str (fs/path (:root cfg) "workspaces" ticket run))]
    (fs/path (:claude-projects cfg) (str/replace workspace #"[^A-Za-z0-9]" "-"))))

(defn- usable-log? [cfg path]
  (<= (fs/size path) (:max-log-bytes cfg)))

(defn find-codex-session
  "Rollouts sit under YYYY/MM/DD. Look at the run's day and the next, so that one lookup does
  not walk the whole session history."
  [cfg started-ms thread]
  (when (and (string? thread) (re-matches #"[0-9a-fA-F-]{8,64}" thread))
    (let [day (java.time.LocalDate/ofInstant (java.time.Instant/ofEpochMilli started-ms) java.time.ZoneOffset/UTC)
          fmt (java.time.format.DateTimeFormatter/ofPattern "yyyy/MM/dd")]
      (first
       (mapcat (fn [d]
                 (let [dir (fs/path (:codex-sessions cfg) (.format d fmt))]
                   (when (fs/directory? dir) (fs/glob dir (str "*" thread ".jsonl")))))
               [day (.plusDays day 1)])))))

(defn- codex-thread-spans
  "Returns {:spans :prompts :status} for an agent span wrapping one Codex thread."
  [ctx cfg started-ms {:keys [key name thread]}]
  (if-let [path (find-codex-session cfg started-ms thread)]
    (if (usable-log? cfg path)
      (let [lines (read-jsonl path)
            [start end] (lines-span-range lines)]
        {:spans (cons (mk-span ctx {:key key :parent "root" :name name :start start :end end
                                    :attrs-map {"langfuse.observation.type" "agent"}})
                      (codex-spans ctx key (str key ":") lines))
         :prompts (codex-system-prompts lines)
         :status "observed"})
      {:status "missing:too_large"})
    {:status "missing:no_session"}))

(defn- review-threads [run-dir]
  (->> (fs/glob run-dir "codex-review-*-usage.jsonl")
       (map str)
       sort
       (mapcat read-jsonl)
       (keep :thread_id)
       distinct))

(defn- merge-status [statuses]
  (cond
    (empty? statuses) "not_applicable"
    (every? #(= "observed" %) statuses) "observed"
    :else (first (remove #(= "observed" %) statuses))))

(defn- claude-sources [ctx cfg ticket run]
  (let [dir (claude-project-dir cfg ticket run)
        files (when (fs/directory? dir) (filter #(usable-log? cfg %) (sort (map str (fs/glob dir "*.jsonl")))))
        subagents (when (fs/directory? dir)
                    (filter #(usable-log? cfg %) (sort (map str (fs/glob dir "*/subagents/*.jsonl")))))
        main-lines (mapcat read-jsonl files)
        sub-parts (map-indexed
                   (fn [idx path]
                     (let [lines (read-jsonl path)
                           key (str "subagent:" (fs/file-name path))
                           [start end] (lines-span-range lines)]
                       {:lines lines
                        :spans (cons (mk-span ctx {:key key :parent "root" :name (str "subagent:" idx)
                                                   :start start :end end
                                                   :attrs-map {"langfuse.observation.type" "agent"}})
                                     (claude-spans ctx key (str key ":") lines))}))
                   subagents)]
    {:spans (concat (claude-spans ctx "root" "claude:" main-lines) (mapcat :spans sub-parts))
     :prompts (concat (claude-system-prompts main-lines) (mapcat (comp claude-system-prompts :lines) sub-parts))
     :counts {:thinking (count (for [line main-lines
                                     :when (= "assistant" (:type line))
                                     block (get-in line [:message :content])
                                     :when (= "thinking" (:type block))] block))}
     :coverage {"coverage.claude_session" (if (seq files) "observed" "missing:no_session")
                "coverage.subagents" (if (seq subagents) "observed" "not_applicable")}}))

(defn- json-file [path]
  (when-let [text (safe-slurp path)]
    (try (json/parse-string text true) (catch Exception _ nil))))

(def max-run-pinned-values 256)

(defn pinned-values-of
  "Values named by a name-based known format anywhere in the bodies of the run, or :overflow."
  [spans]
  (let [values (->> spans
                    (mapcat :attributes)
                    (filter #(contains? #{"langfuse.observation.input" "langfuse.observation.output"} (:key %)))
                    (mapcat #(:values (named-values (get-in % [:value :stringValue]))))
                    distinct vec)]
    (if (> (count values) max-run-pinned-values) :overflow values)))

(defn- build-run*
  "Returns {:spans raw-spans :root-key ...} for one terminal run. Nothing here is redacted yet."
  [cfg ticket run]
  (let [run-dir (fs/path (:root cfg) "runs" ticket run)
        summary (edn/read-string (or (safe-slurp (fs/path run-dir "summary.edn")) "{}"))
        started (or (run-started-ms run) 0)
        finished (or (->millis (:finished-at summary)) started)
        tid (trace-id ticket run)
        agent-name (str (:agent summary "unknown"))
        action (some-> (:action summary) name)
        base-attrs {"langfuse.session.id" ticket
                    "langfuse.trace.name" (str "task-board-run " ticket)
                    "langfuse.trace.tags" (cond-> ["task-board" (str "ticket:" ticket) (str "agent:" agent-name)]
                                            action (conj (str "action:" action)))
                    "langfuse.trace.metadata.run_id" run
                    "langfuse.trace.metadata.lane" (str (:lane summary ""))
                    "langfuse.trace.metadata.status" (some-> (:status summary) name str)
                    "langfuse.trace.metadata.agent" agent-name
                    "langfuse.trace.metadata.action" (str action)
                    "langfuse.trace.metadata.exporter_version" exporter-version
                    "langfuse.trace.metadata.coverage.tool_bodies" "sent through the known-format mask; withheld after a known source, an environment dump or a known format in a tool result (body_policy on each observation)"
                    "langfuse.trace.metadata.coverage.reasoning" "not_collected"
                    "langfuse.trace.metadata.coverage.provider_payload"
                    "partial: Claude api-request-blob and Codex response_item only; the CLI may add content it does not log"}
        pre-ctx {:tid tid :trace-attrs base-attrs}
        claude? (str/starts-with? agent-name "claude")
        claude (when claude? (claude-sources pre-ctx cfg ticket run))
        events (when (fs/exists? (fs/path run-dir "events.jsonl")) (read-jsonl (fs/path run-dir "events.jsonl")))
        main-thread (:thread_id (first (filter #(= "thread.started" (:type %)) events)))
        delegation (json-file (fs/path run-dir "delegation.json"))
        delegate-thread (when (= "delegated" (:kind delegation)) (:thread delegation))
        threads (concat
                 (when main-thread [{:source "coverage.codex_session" :key "codex" :name "codex-session" :thread main-thread}])
                 (when delegate-thread [{:source "coverage.delegate" :key "delegate" :name "delegate:codex" :thread delegate-thread}])
                 (map-indexed (fn [i thread] {:source "coverage.review_gate" :key (str "review:" i) :name "review-gate" :thread thread})
                              (when (fs/directory? run-dir) (review-threads run-dir))))
        parts (mapv (fn [spec] (assoc (codex-thread-spans pre-ctx cfg started spec) :source (:source spec))) threads)
        coverage (merge {"coverage.claude_session" "not_applicable"
                         "coverage.subagents" "not_applicable"
                         "coverage.codex_session" "not_applicable"
                         "coverage.delegate" (if (= "exempt" (:kind delegation)) "not_applicable:exempt" "not_applicable")
                         "coverage.review_gate" "not_applicable"}
                        (:coverage claude)
                        (into {} (map (fn [[source ps]] [source (merge-status (map :status ps))])
                                      (group-by :source parts))))
        trace-attrs (into base-attrs (map (fn [[k v]] [(str "langfuse.trace.metadata." k) v]) coverage))
        ;; Spans built above carry base-attrs. Replace them so all spans show the same coverage.
        all-attrs (attrs trace-attrs)
        reattr (fn [span]
                 (let [fixed (set (map :key (attrs base-attrs)))]
                   (assoc span :attributes
                          (into all-attrs (remove #(fixed (:key %)) (:attributes span))))))
        ctx {:tid tid :trace-attrs trace-attrs}
        root (mk-span ctx {:key "root" :name (str "task-board-run " ticket) :start started :end finished
                           :attrs-map {"langfuse.observation.input" (or (safe-slurp (fs/path run-dir "prompt.md")) "")
                                       "langfuse.observation.output" (or (safe-slurp (fs/path run-dir "last-message.md")) "")
                                       "langfuse.observation.metadata.source" "runner_assembled"}})
        prompts (->> (concat (:prompts claude) (mapcat :prompts parts))
                     (reduce (fn [acc p] (if (contains? acc (:hash p)) acc (assoc acc (:hash p) p))) {})
                     vals
                     (map #(system-prompt-span ctx (assoc % :parent "root" :ts (or (:ts %) started)))))
        children0 (mapv reattr (concat (:spans claude) (mapcat :spans parts)))
        span-type (fn [span] (some #(when (= "langfuse.observation.type" (:key %)) (get-in % [:value :stringValue])) (:attributes span)))
        policy-of (fn [span] (some #(when (= "langfuse.observation.metadata.body_policy" (:key %)) (get-in % [:value :stringValue])) (:attributes span)))
        evidence (filter #(contains? #{"withheld_known_source" "withheld_env_dump" "withheld_unscanned_output" "masked_known_format"} (policy-of %)) children0)
        first-evidence (first (sort-by #(bigint (:endTimeUnixNano %)) evidence))
        reason (some-> (policy-of first-evidence) ({"withheld_known_source" "known_source" "withheld_env_dump" "env_dump" "withheld_unscanned_output" "unscanned_output" "masked_known_format" "known_format_in_tool_output"}))
        agent-ids (set (map :spanId (filter #(= "agent" (span-type %)) children0)))
        child-gen-ids (set (map :spanId (filter #(and (= "generation" (span-type %)) (agent-ids (:parentSpanId %))) children0)))
        child-span? (fn [span] (or (agent-ids (:parentSpanId span)) (child-gen-ids (:parentSpanId span))))
        main-evidence (first (sort-by #(bigint (:endTimeUnixNano %)) (remove child-span? evidence)))
        child-evidence (first (sort-by #(bigint (:endTimeUnixNano %)) (filter child-span? evidence)))
        after? (fn [span hit] (and hit (or (= "0" (:startTimeUnixNano span)) (= "0" (:endTimeUnixNano hit))
                                             (>= (bigint (:startTimeUnixNano span)) (bigint (:endTimeUnixNano hit))))))
        withhold (fn [span]
                   (update span :attributes (fn [items]
                     (mapv #(cond
                              (contains? #{"langfuse.observation.input" "langfuse.observation.output"} (:key %)) (assoc-in % [:value :stringValue] withheld-model-output)
                              (= "langfuse.observation.metadata.body_policy" (:key %)) (assoc-in % [:value :stringValue] (str "withheld_after_" reason))
                              :else %) items))))
        children (mapv (fn [span]
                         (if (and reason (contains? #{"generation" "tool"} (span-type span))
                                  ;; Evidence spans are not exempt: a child's masked known-format result after the parent read a
                                  ;; known source may carry the parent's plain value, so only already-withheld spans are skipped.
                                  (not (str/starts-with? (or (policy-of span) "") "withheld_"))
                                  (or (and (child-span? span) (after? span main-evidence))
                                      (and (not (child-span? span)) (after? span child-evidence))))
                           (withhold span) span)) children0)
        root (cond-> root reason (update :attributes (fn [items] (conj (mapv #(if (= "langfuse.observation.output" (:key %)) (assoc-in % [:value :stringValue] withheld-model-output) %) items)
                                                                             (attr "langfuse.observation.metadata.body_policy" (str "withheld_after_" reason))))))
        add-reason (fn [span] (update span :attributes conj (attr "langfuse.trace.metadata.coverage.withheld_reason" (or reason "none"))))
        root (add-reason root)
        children (mapv add-reason children)
        prompts (map add-reason prompts)]
    {:ticket ticket :run run :trace-id tid
     :root root
     :spans (concat prompts children)
     :pinned-values (pinned-values-of (concat [root] prompts children))
     :counts (:counts claude)}))

(defn build-run [cfg ticket run]
  (binding [*exposure-values* (:secret-values cfg)]
    (build-run* cfg ticket run)))

;; ---------------------------------------------------------------- sanitizing

(defn sanitize-span
  "Mask before truncating; all spool payloads pass this and the final guard."
  [cfg tally span]
  (let [clean (fn [s]
                (let [{:keys [value redactions]} (*redact-field* s (:secret-values cfg))]
                  (when (seq redactions) (swap! tally #(merge-with + % redactions)))
                  (truncate-field value (:max-field-bytes cfg))))
        span (-> span
                 (update :name clean)
                 (update :attributes (fn [items] (mapv (fn [item] (update item :value #(walk/postwalk (fn [x] (if (string? x) (clean x) x)) %))) items))))
        attrs (:attributes span)
        current (some #(when (= "langfuse.observation.metadata.body_policy" (:key %)) (get-in % [:value :stringValue])) attrs)
        bodies (keep #(when (contains? #{"langfuse.observation.input" "langfuse.observation.output"} (:key %)) (get-in % [:value :stringValue])) attrs)
        policy (cond (and current (not= current "sent")) current
                     (some #(str/includes? % "[REDACTED:") bodies) "masked_known_format"
                     (some #(str/includes? % "[truncated") bodies) "truncated"
                     :else "sent")]
    (assoc span :attributes (conj (vec (remove #(= "langfuse.observation.metadata.body_policy" (:key %)) attrs))
                                  (attr "langfuse.observation.metadata.body_policy" policy)))))

(defn span-safe?
  "The final guard. It covers every string in the span, whatever the per-field pass did."
  [cfg span]
  (let [strings (concat [(:name span)] (filter string? (tree-seq coll? seq (map :value (:attributes span)))))]
    (every? #(guard-safe? % (:secret-values cfg)) strings)))

(declare prepare-spans*)
(defn prepare-spans
  "Returns {:spans :stats}: sanitized, capped and final-guarded spans (root first), or
  :failed when the root itself does not pass the guard."
  [cfg {:keys [root spans pinned-values]}]
  (if (= :overflow pinned-values)
    {:failed "pinned_values_over_limit" :stats {:redactions {} :dropped-secret-guard 0}}
    (prepare-spans* (update cfg :secret-values #(vec (distinct (concat % pinned-values)))) root spans)))

(defn- prepare-spans* [cfg root spans]
  (let [tally (atom {})
        clean-root (sanitize-span cfg tally root)
        limit (dec (:max-spans cfg))
        raw (take (inc limit) spans)
        over-count? (> (count raw) limit)
        cleaned (mapv #(sanitize-span cfg tally %) (take limit raw))
        guarded (filterv #(span-safe? cfg %) cleaned)
        guard-drops (- (count cleaned) (count guarded))
        {:keys [kept bytes]}
        (reduce (fn [{:keys [kept bytes] :as acc} span]
                  (let [size (bytes-of (json/generate-string span))
                        total (+ bytes size)]
                    (if (> total (:max-run-bytes cfg))
                      (reduced acc)
                      {:kept (conj kept span) :bytes total})))
                {:kept [] :bytes 0}
                guarded)
        truncated? (or over-count? (< (count kept) (count guarded)))
        clean-root (cond-> clean-root
                     truncated? (update :attributes conj (attr "langfuse.trace.metadata.coverage.truncated" "true"))
                     (pos? guard-drops) (update :attributes conj (attr "langfuse.trace.metadata.coverage.dropped_guard" (str guard-drops))))]
    (if (span-safe? cfg clean-root)
      {:spans (into [clean-root] kept)
       :stats {:redactions @tally :dropped-secret-guard guard-drops :bytes bytes :truncated truncated?}}
      {:failed "secret_guard_root"
       :stats {:redactions @tally :dropped-secret-guard (inc guard-drops)}})))

(defn- otlp-payload [spans]
  {:resourceSpans
   [{:resource {:attributes [(attr "service.name" "task-board")]}
     :scopeSpans [{:scope {:name "boxp-task-board-exporter" :version exporter-version}
                   :spans spans}]}]})

(defn batches
  "Split into payload strings below the batch limit. A span larger than the limit stands alone."
  [cfg spans]
  (let [{:keys [done current]}
        (reduce (fn [{:keys [done current size]} span]
                  (let [s (bytes-of (json/generate-string span))]
                    (if (and (seq current) (> (+ size s) (:max-batch-bytes cfg)))
                      {:done (conj done current) :current [span] :size s}
                      {:done done :current (conj current span) :size (+ size s)})))
                {:done [] :current [] :size 0}
                spans)]
    (mapv #(json/generate-string (otlp-payload %)) (cond-> done (seq current) (conj current)))))

;; --------------------------------------------------------------------- state

(defn- atomic-write [path content]
  (let [dir (fs/parent path)
        tmp (fs/create-temp-file {:dir dir :prefix ".tmp-"})]
    (fs/set-posix-file-permissions tmp "rw-------")
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn- ensure-dirs [cfg]
  (fs/create-dirs (:spool cfg))
  (fs/set-posix-file-permissions (:dir cfg) "rwx------")
  (fs/set-posix-file-permissions (:spool cfg) "rwx------"))

(defn load-state [cfg now-ms]
  (ensure-dirs cfg)
  (let [existing (when (fs/exists? (:state-file cfg))
                   (try (edn/read-string (slurp (str (:state-file cfg)))) (catch Exception _ nil)))]
    ;; A state file that cannot be read restarts the cutoff at now, so a bad file can never
    ;; turn into a backfill of older runs.
    (merge {:cutoff-ms now-ms :markers {} :attempts {} :metrics {}} existing)))

(defn- prune-state [cfg state now-ms]
  (update state :markers
          (fn [markers]
            (into {} (filter (fn [[_ m]] (< (- now-ms (:at m 0)) (:marker-keep-ms cfg))) markers)))))

(defn save-state [cfg state] (atomic-write (:state-file cfg) (pr-str state)))

(defn- bump [state k n] (update-in state [:metrics k] (fnil + 0) n))

(defn- bump-labelled [state k label n]
  (update-in state [:metrics k (name label)] (fnil + 0) n))

(defn write-metrics [cfg state]
  (let [m (:metrics state)
        line (fn [k v] (str "langfuse_exporter_" k " " v))
        labelled (fn [k label-name values]
                   (map (fn [[label v]] (str "langfuse_exporter_" k "{" label-name "=\"" label "\"} " v)) (sort values)))
        spool-bytes (reduce + 0 (map fs/size (fs/list-dir (:spool cfg))))
        text (str/join "\n"
                       (concat
                        (map (fn [k] (line (name k) (get m k 0)))
                             [:runs_exported :runs_failed :spans_sent :batches_sent :batches_failed
                              :dropped_secret_guard :spool_evicted :last_success_timestamp])
                        [(line "spool_bytes" spool-bytes)
                         (line "idle" (if (:idle-reason state) 1 0))]
                        (labelled "batches_dropped" "reason" (:batches_dropped m))
                        (labelled "redactions" "kind" (:redactions m))
                        [""]))]
    (atomic-write (:metrics-file cfg) text)))

;; --------------------------------------------------------------------- spool

(defn- spool-files [cfg]
  (->> (fs/list-dir (:spool cfg))
       (filter #(str/ends-with? (str %) ".json"))
       (sort-by (comp str fs/file-name))))

(defn- drop-spool-file [state path reason]
  (fs/delete-if-exists path)
  (-> state
      (update :attempts dissoc (str (fs/file-name path)))
      (bump-labelled :batches_dropped reason 1)))

(defn bound-spool
  "Enforce the TTL first, then remove the oldest files until the spool fits."
  [cfg state now-ms]
  (let [expired? (fn [f] (> (- now-ms (.toMillis (fs/last-modified-time f))) (:spool-ttl-ms cfg)))
        after-ttl (reduce (fn [st f] (if (expired? f) (drop-spool-file st f :ttl) st)) state (spool-files cfg))
        files (spool-files cfg)
        total (reduce + 0 (map fs/size files))]
    (first
     (reduce (fn [[st remaining] f]
               (if (> remaining (:spool-max-bytes cfg))
                 (let [size (fs/size f)]
                   [(-> (drop-spool-file st f :spool_full) (bump :spool_evicted 1)) (- remaining size)])
                 (reduced [st remaining])))
             [after-ttl total]
             files))))

(defn enqueue! [cfg tid payloads now-ms]
  (doseq [[i payload] (map-indexed vector payloads)]
    (atomic-write (fs/path (:spool cfg) (format "%013d-%s-%04d.json" now-ms tid i)) payload)))

(defn post-batch
  "Returns :ok, :retry or :drop. A rejected payload will not succeed on a later attempt."
  [cfg body]
  (try
    ;; HTTP/1.1: the default sends `Upgrade: h2c`, and Langfuse closes such a connection unanswered.
    (let [client (http/client {:connect-timeout (:connect-timeout-ms cfg) :version :http1.1})
          auth (.encodeToString (java.util.Base64/getEncoder)
                                (.getBytes (str (:public-key cfg) ":" (:secret-key cfg)) "UTF-8"))
          res (http/post (str (:url cfg) "/api/public/otel/v1/traces")
                         {:client client
                          :timeout (:request-timeout-ms cfg)
                          :throw false
                          :headers {"Authorization" (str "Basic " auth)
                                    "Content-Type" "application/json"
                                    "x-langfuse-ingestion-version" "4"}
                          :body body})
          status (:status res)]
      (cond
        (<= 200 status 299) :ok
        (or (= 429 status) (= 401 status) (= 403 status) (<= 500 status)) :retry
        :else :drop))
    (catch Throwable _ :retry)))

(defn- span-count [body]
  (count (get-in (json/parse-string body true) [:resourceSpans 0 :scopeSpans 0 :spans])))

(defn drain-spool
  "One attempt per tick when the service is failing, with exponential backoff between ticks."
  [cfg state now-ms]
  (if (< now-ms (:next-attempt-ms state 0))
    state
    (loop [st state files (spool-files cfg)]
      (if-let [f (first files)]
        (let [body (slurp (str f))
              fname (str (fs/file-name f))]
          (case (post-batch cfg body)
            :ok (do (fs/delete-if-exists f)
                    (Thread/sleep (long (:batch-pause-ms cfg)))
                    (recur (-> st
                               (update :attempts dissoc fname)
                               (dissoc :failures :next-attempt-ms)
                               (bump :batches_sent 1)
                               (bump :spans_sent (span-count body))
                               (assoc-in [:metrics :last_success_timestamp] (quot (System/currentTimeMillis) 1000)))
                           (rest files)))
            :drop (recur (drop-spool-file st f :rejected) (rest files))
            :retry (let [attempts (inc (get-in st [:attempts fname] 0))
                         failures (inc (:failures st 0))
                         delay-ms (min (:backoff-max-ms cfg)
                                       (* (:backoff-base-ms cfg) (bit-shift-left 1 (min 16 (dec failures)))))
                         st (-> st
                                (bump :batches_failed 1)
                                (assoc :failures failures :next-attempt-ms (+ now-ms delay-ms)))]
                     (if (>= attempts (:max-attempts cfg))
                       (drop-spool-file st f :max_attempts)
                       (assoc-in st [:attempts fname] attempts)))))
        st))))

;; ---------------------------------------------------------------- run export

(defn- candidate-runs [cfg state now-ms]
  (let [runs-root (fs/path (:root cfg) "runs")]
    (when (fs/directory? runs-root)
      (let [floor (max (:cutoff-ms state) (- now-ms (:max-age-ms cfg)))]
        (for [ticket-dir (sort (map str (fs/list-dir runs-root)))
              :let [ticket (str (fs/file-name ticket-dir))]
              :when (and (re-matches #"[A-Z]+-\d+" ticket) (fs/directory? ticket-dir))
              run-dir (sort (map str (fs/list-dir ticket-dir)))
              :let [run (str (fs/file-name run-dir))
                    started (run-started-ms run)]
              :when (and started (>= started floor)
                         (not (contains? (:markers state) (str ticket "/" run))))]
          {:ticket ticket :run run :dir run-dir})))))

(defn terminal? [cfg dir now-ms]
  (let [summary (try (edn/read-string (or (safe-slurp (fs/path dir "summary.edn")) "{}"))
                     (catch Exception _ {}))
        finished (->millis (:finished-at summary))]
    (and finished
         (not= :running (:status summary))
         (>= (- now-ms finished) (:terminal-settle-ms cfg)))))

(defn- apply-stats [state stats]
  (reduce (fn [st [kind n]] (bump-labelled st :redactions kind n))
          (bump state :dropped_secret_guard (:dropped-secret-guard stats 0))
          (:redactions stats)))

(defn export-run!
  "Spool one run. Never throws: a failed run gets a marker with a reason and is not retried."
  [cfg state {:keys [ticket run]} now-ms]
  (let [marker-key (str ticket "/" run)]
    (try
      (let [{:keys [spans failed stats]} (prepare-spans cfg (build-run cfg ticket run))
            state (apply-stats state stats)]
        (if failed
          (-> state
              (bump :runs_failed 1)
              (assoc-in [:markers marker-key] {:status :failed :reason failed :at now-ms}))
          (do
            (enqueue! cfg (trace-id ticket run) (batches cfg spans) now-ms)
            (-> state
                (bump :runs_exported 1)
                (assoc-in [:markers marker-key] {:status :spooled :at now-ms})))))
      (catch Throwable e
        (-> state
            (bump :runs_failed 1)
            ;; The class name only: exception messages can quote what was being parsed.
            (assoc-in [:markers marker-key] {:status :failed :reason (.getName (class e)) :at now-ms}))))))

(defn once
  "One tick. Nothing escapes it. Without credentials it stays idle and consumes no run."
  [cfg]
  (try
    (let [now-ms (System/currentTimeMillis)
          state (load-state cfg now-ms)
          state (prune-state cfg state now-ms)]
      (if-not (and (:public-key cfg) (:secret-key cfg))
        (let [state (assoc state :idle-reason "no_credentials")]
          (save-state cfg state)
          (write-metrics cfg state)
          state)
        (let [state (dissoc state :idle-reason)
              runs (->> (candidate-runs cfg state now-ms)
                        (filter #(terminal? cfg (:dir %) now-ms))
                        (take (:max-runs-per-tick cfg)))
              state (reduce (fn [st r]
                              (let [next-state (export-run! cfg st r now-ms)]
                                (save-state cfg next-state)
                                next-state))
                            state runs)
              state (bound-spool cfg state now-ms)
              state (drain-spool cfg state now-ms)]
          (save-state cfg state)
          (write-metrics cfg state)
          state)))
    (catch Throwable e
      (binding [*out* *err*] (println "langfuse-exporter tick failed:" (.getName (class e))))
      nil)))

(defn dry-run-report [cfg ticket run]
  (let [{:keys [spans failed stats]} (prepare-spans cfg (build-run cfg ticket run))
        type-of (fn [span] (or (some (fn [a] (when (= "langfuse.observation.type" (:key a)) (get-in a [:value :stringValue])))
                                     (:attributes span))
                               "span"))]
    {:failed failed
     :observations (frequencies (map type-of spans))
     :batches (when spans (count (batches cfg spans)))
     :redactions (:redactions stats)
     :dropped_secret_guard (:dropped-secret-guard stats)
     :truncated (boolean (:truncated stats))}))

(defn status-report [cfg]
  (let [state (load-state cfg (System/currentTimeMillis))
        files (spool-files cfg)]
    {:cutoff (str (java.time.Instant/ofEpochMilli (:cutoff-ms state)))
     :configured (boolean (and (:public-key cfg) (:secret-key cfg)))
     :markers (frequencies (map :status (vals (:markers state))))
     :spool_files (count files)
     :spool_bytes (reduce + 0 (map fs/size files))
     :next_attempt_ms (:next-attempt-ms state)
     :metrics (:metrics state)}))

(defn -main [& args]
  (let [cfg (config (into {} (System/getenv)))
        [cmd a b flag] args]
    (case cmd
      "once" (do (once cfg) nil)
      "status" (prn (status-report cfg))
      "delete-state" (do (fs/delete-tree (:dir cfg)) (println "deleted exporter state and spool"))
      "export-run"
      (if (= "--dry-run" flag)
        (prn (dry-run-report cfg a b))
        (let [now-ms (System/currentTimeMillis)
              state (load-state cfg now-ms)
              started (run-started-ms b)]
          (if (and started (>= started (:cutoff-ms state)))
            (let [state (export-run! cfg state {:ticket a :run b} now-ms)
                  state (drain-spool cfg state now-ms)]
              (save-state cfg state)
              (write-metrics cfg state)
              (println (get-in state [:markers (str a "/" b) :status])))
            (do (binding [*out* *err*] (println "run is older than the cutoff; backfill is not allowed"))
                (System/exit 2)))))
      (do (binding [*out* *err*]
            (println "usage: langfuse_exporter.bb once|status|delete-state|export-run <ticket> <run> [--dry-run]"))
          (System/exit 2)))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
