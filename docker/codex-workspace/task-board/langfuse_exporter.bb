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

(def quote-pattern "(?:\\\\*[\"']|\\\\+u00(?:22|27)|&quot;|&#0*(?:34|39);|&#x0*(?:22|27);)")
(def gap-pattern "(?:\\s|\\\\+[nrt])*")
(def secret-key-pattern (str "[\\w.-]{0,64}(?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential|session[_-]?id|cookie|authorization|(?<![a-z])pass(?![a-z])|(?<![a-z])auth(?![a-z]))[\\w.-]{0,64}"))
(defn value-pattern [limit bare]
  (str "(?:(?<quote>" quote-pattern ")(?:[^\\n]" (or limit "*?") "(?<!\\\\)\\k<quote>" (when-not limit "|[^\\n]*") ")|" bare ")"))
(defn entry-key [name] (str "(?<![\\w-])" name "(?:" quote-pattern ")?" gap-pattern "[:=]" gap-pattern))
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
   [:cli-password #"(?i)(?<![\w-])(?:-u|--user)[ \t=]*(?!\d+:\d+\b)[^\s:]+:\S+|\b(?:mysql\w*|mariadb\w*)\b[^\n|;&]{0,512}?\s-p\S+|\bsshpass\b[^\n|;&]{0,512}?\s-p[ \t]*\S+"]
   ;; A number after a name with token in it is a counter such as input_tokens: 12.
   [:assignment (re-pattern (str "(?i)[\"']?" secret-key-pattern "(?:" quote-pattern ")?" gap-pattern "(?:[:=]|\\\\+u00(?:3[aA]|3[dD]))" gap-pattern "(?!(?<=token[\\w.-]{0,16}[\"'\\\\]{0,8}\\s{0,4}[:=]\\s{0,4})\\d+(?:[\\s,;}\\\\\"']|$))(?:[|>][-+]?\\d?(?:(?:\\n|\\\\+n)[ \\t]+(?:(?!\\\\+n)[^\\n])*)+|" (value-pattern nil "[^\\s,;}\\]]+") ")"))]
   [:entropy #"\b[A-Za-z0-9_-]{40,}\b"]])

(def not-a-credential-name #"^(?:PWD|OLDPWD)$")
(def flag-value #"(?i)true|false|yes|no|on|off|none|null|nil|enabled|disabled|0|1")
;; Whole words of the name, at its ends: MINIO_ROOT_PASSWORD holds "min" and SUPPORT_SECRET holds "port".
(def toggle-last-word #"(?i)enabled?|disabled?|required?|parallelism|rotation")
(def toggle-first-word #"(?i)use|enable|disable|no|skip|require")
(def counter-last-word #"(?i)tokens|count|limit|max|min|ttl|timeout|expiry|expires|interval|seconds|minutes|hours|days|age|size|port|bytes|length|len|chars|characters|attempts|retries|history|digits")

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
(def secret-element (re-pattern (str "(?is)(?:<|&lt;|&#0*60;|&#x0*3c;|\\\\+u003c)(?<tag>[\\w:.-]{0,64}" (.pattern loose-word) "[\\w:.-]{0,64})(?=[\\s/>&\\\\]).*?(?:(?:<|&lt;|&#0*60;|&#x0*3c;|\\\\+u003c)\\\\*/\\k<tag>\\s*(?:>|&gt;|&#0*62;|&#x0*3e;|\\\\+u003e)|\\z)")))

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

;; Same sources as the Hermes observer (_SENSITIVE_PATH). A file named for tokens (/tmp/tokens, tokens.json,
;; refresh_tokens.txt) or a private key/keystore file holds a bare value with no key or known format left to mask,
;; so reading it withholds the body. A bare key such as max_output_tokens has no path separator or extension, so it
;; is not a path. A file named for a password, passphrase, secret or credentials (/tmp/password, db_password,
;; secret.txt) holds a bare value the same way; the bare word counts only as a whole argument (cat password), so
;; grep -rn password src stays readable. File-name parts are bounded so a long line is scanned in linear time.
(def sensitive-path
  #"(?i)(?:(?:^|[/\\\s\"'=])(?:auth\.json|\.credentials[^/\s\"']*|\.env[^/\s\"']*|\.ssh(?:[/\\]|\b)|\.aws(?:[/\\]|\b)|kubeconfig|\.git-credentials|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|\.gnupg(?:[/\\]|\b)|secrets?[/\\]|(?<=/)secrets?(?=$|[\s\"'])|tokens?(?=[\s\"'/\\]|\z)|[^/\\\s\"'=]{0,255}?token(?=[\s\"'/\;|&)]|\z)|[^/\\\s\"'=]{0,255}?\.(?:key|pem|p8|p12|pfx|jks|keystore|ppk)(?=[\s\"';|&)]|\z))|[/\\][^/\\\s\"']{0,255}?token|token[^/\\\s\"']{0,255}?(?:\.[A-Za-z0-9]+(?![\w-])|[/\\]))|(?<=[/\\])[^/\\\s\"']{0,255}?(?:passw(?:or)?ds?|passphrases?|secrets?|credentials?)(?:\.[A-Za-z0-9]{1,16})?(?=[\s\"'/\;|&)]|\z)|(?:^|(?<=[\s\"'=]))[^/\\\s\"'=]{0,255}?(?:passw(?:or)?ds?|passphrases?|secrets?|credentials?)\.[A-Za-z0-9]{1,16}(?=[\s\"';|&)]|\z)|(?:^|(?<=[\s\"'=]))(?:passw(?:or)?ds?|passphrases?|secrets?|credentials?)(?=[\"']|\z)")
(def sensitive-command
  #"(?i)(?:^|[;&|\s\"'(`/]|\\[nrt])(?:env(?:[ \t]+(?:-\S*|[A-Za-z_]\w*=\S*))*[ \t]*(?:[\"'|;&<>)`]|\\[nrt]|$)|printenv(?:[\s\"'|;&<>)]|$))|(?:^|[;&|\s\"'(`/])(?:set|export|declare|typeset)(?:\s+-[a-z]*[px]\b|[ \t]*(?:$|[|;&<>\"')`#]|\\[nrt\"]))|\benviron\b|\bprocess\.env\b|\bgetenv\b|\baws\b[^|;&\n]{0,1024}\b(?:ssm\s+get-parameter|secretsmanager\s+get-|configure\s+(?:get|export-credentials))|\bhelm\s+get\b|\bgh\s+auth\s+token\b|\bgit\s+credential\b")
;; A file-reading command whose argument list names a secret file anywhere (cat password /tmp/other) prints that
;; file; the bare-word clause of sensitive-path only sees it as the last argument, so grep/rg/echo searches and
;; messages that mention the word stay readable (P0 arch#14503 :272).
(def secret-file-read
  #"(?i)(?:^|[;&|\s\"'(`])(?:cat|tac|head|tail|less|more|bat|batcat|nl|od|xxd|hexdump|strings|base64|source|\.)(?=[\s\"'])[^;&|\n]{0,1024}?(?<=[\s\"'=])(?:passw(?:or)?ds?|passphrases?|secrets?|credentials?)(?=[\s\"';|&)]|\z)")
(defn withhold-output? [input]
  (let [s (str input)] (boolean (or (re-find sensitive-path s) (re-find sensitive-command s) (re-find secret-file-read s)
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

(def body-tools #{"Task" "Agent" "TodoWrite" "delegate_task" "delegate" "spawn_agent"})
(def withheld-model-output "[withheld: the model has seen tool output]")

(def max-session-values 2048)
(def value-stopword #"(?i)https?|basic|bearer|digest|negotiate|user|username|name|value|true|false|null|none")

(defn- candidate-values [output]
  (->> (str/split (str output) segment-break)
       (filter #(re-find loose-word %))
       (mapcat #(str/split % #"[\s\"'`,;:=<>()\[\]{}]+"))
       ;; A plain lowercase word is prose, not a value: masking it would blank words such as "generation".
       (filter #(and (<= 6 (count %) 128) (not (re-find loose-word %))
                     (not (re-matches #"[a-z]+|[0-9]{1,5}" %))))
       set))

(defn- strip-value [v]
  (-> (str v) str/trim (str/replace #"^(?:[\"'`]|\\+[\"'nrt]?)+|(?:[\"'`,;]|\\+[\"'nrt]?)+$" "") str/trim))

(def reference-value #"(?i)\$\{?[\w.-]*\}?|<[^>]*>|\{\{[^}]*\}\}|\[REDACTED:[a-z_-]+\]|\*+|x{3,}|\.\.\.|…|-|\|")

(defn- reference? [t]
  (or (str/blank? t) (re-find loose-word t) (re-matches value-stopword t) (re-matches reference-value t)
      (re-matches #"(?i)name|key|ref|from|data" t)))

(defn- token-values
  "Values to mask for matched text. A single token is the value itself; a value of several words keeps the whole
  text and its secret-looking tokens. A reference (a variable, placeholder, secret name or key word) is skipped.
  A value under 4 characters cannot be masked everywhere without blanking ordinary text (password: 123 and a later
  bare 123), so it returns nil and the caller withholds this body and the bodies after it."
  [raw]
  (reduce (fn [acc v]
            (let [tokens (remove reference? (map strip-value (str/split v #"[\s\"'`,;:=<>()\[\]{}\\]+")))]
              (cond (or (nil? acc) (reference? v) (empty? tokens)) acc
                    (some #(< (count %) 4) tokens) nil
                    (= 1 (count tokens)) (conj acc (first tokens))
                    :else (into (conj acc v) (filter #(and (>= (count %) 6) (not (re-matches #"[a-z]+|[0-9]{1,5}" %))) tokens)))))
          #{}
          (keep #(let [v (strip-value %)] (when-not (str/blank? v) v)) raw)))

(defn- pinned-values
  "The values a pattern match shows, so they can be masked wherever the model repeats them, or nil (withhold)."
  [kind m]
  (case kind
    :private-key nil
    (token-values
     (case kind
       :header [(second (re-find #"(?s)^[^:]*:\s*(.*)$" m))]
       :url-credentials [(second (re-find #"://[^:/@\s]*:([^@\s]*)@" m))]
       :cli-password [(-> (last (str/split m #"\s+")) (str/replace #"^(?:-p|(?:-u|--user)=?)" "") (str/replace #"^[^:]*:(?=.)" ""))]
       :flag [(last (str/split m #"[ \t]+"))]
       :assignment (let [[_ k v] (re-find #"(?s)^[\"']?([\w.-]*).*?(?:[:=]|\\+u00(?:3[aA]|3[dD]))(.*)$" m)]
                     ;; A setting such as password_min_length: 8 is no value to pin or withhold for.
                     (if (setting? (str k) (strip-value v)) [] [v]))
       :bearer [(second (re-find #"(?i)bearer\s+(.*)" m))]
       :env-entry (str/split m #"[\s\"'`,;:=<>()\[\]{}\\]+")
       [m]))))

(defn- block-values
  "Values of secret-named YAML/JSON blocks and XML elements, or nil when one cannot be pinned."
  [text]
  (let [matcher (.matcher structured-key text)
        reversed (atom 0)]
    (mask-reversed-entries text (fn [_] (swap! reversed inc) ""))
    (when (zero? @reversed)
      (loop [position 0 values #{} n 0]
        (cond
          (> n 200) nil
          (.find matcher position)
          (let [end (structured-end text matcher)]
            (if end
              (when-let [found (token-values (str/split (subs text (.end matcher) end) #"\r?\n|\\+n"))]
                (recur end (into values found) (inc n)))
              (recur (max (.end matcher) (inc position)) values n)))
          :else
          (let [elements (map #(if (vector? %) (first %) %) (take 201 (re-seq secret-element text)))
                pinned (map #(token-values [(str/replace % #"(?s)^[^>]*>|<[^<]*$" "")]) elements)]
            (when (and (<= (count elements) 200) (not-any? nil? pinned))
              (into values (apply concat pinned)))))))))

(defn- exposure
  "{:reason r} when text shows the model a secret that cannot be pinned to a value, {:values vs} when it can, nil otherwise."
  [text]
  (let [text (str text)]
    (if (> (count text) 262144)
      {:reason "unscanned_large_output"}
      (try
        (if-let [blocks (block-values text)]
          (loop [[[kind pattern] & more] patterns values blocks seen 0]
            (if-not kind
              (when (seq values) {:values values})
              (let [matches (take 201 (map #(if (vector? %) (first %) %) (re-seq pattern text)))
                    matches (if (= kind :entropy) (filter entropy-secret? matches) matches)
                    pinned (map #(pinned-values kind %) matches)]
                (cond (> (+ seen (count matches)) 200) {:reason "unscanned_large_output"}
                      (some nil? pinned) {:reason "value_exposure"}
                      :else (recur more (into values (apply concat pinned)) (+ seen (count matches)))))))
          {:reason "value_exposure"})
        (catch Throwable _ {:reason "scan_error"})))))

;; Prose that names a value with a secret word ("the password is huntertwo", "kiwimango is my password"). A plain
;; lowercase value is pinned here although candidate-values skips plain words, because the secret word and a copula
;; or separator name it (P0 arch#14503). A secret word without such a separator ("the token generation ...",
;; "Reset your password") is a mention and pins nothing (TD-07).
(def prose-connective #"(?i)a|an|the|be|been|being|to|for|of|on|in|at|by|as|it|its|this|that|these|those|and|or|my|your|our|their|his|her|new|old|current|still|just|also|now|here|there|then|set|now")
(def prose-separator #"(?i)is|are|was|were|:|=")
(def prose-question #"(?i)what|which|where|who|whose|how|why|when|not|no")
(def max-prose-values 64)

(defn- secret-name-token? [t]
  (boolean (and (re-find loose-word t) (re-matches #"[A-Za-z_.-]{1,64}" t))))

(defn- prose-tokens [line]
  (->> (re-seq #"[:=]|[^\s\"'`,;:=<>()\[\]{}]+" line)
       (map #(str/replace % #"^[.!?]+|[.!?]+$" ""))
       (remove str/blank?)
       vec))

(defn- prose-line-values
  "[values short?] for one line, or nil when no secret word names a value on it."
  [line]
  (let [tokens (prose-tokens line)
        i (first (keep-indexed (fn [i t] (when (secret-name-token? t) i)) tokens))]
    (when i
      (let [name (nth tokens i)
            after (drop (inc i) tokens)
            gap (take-while #(or (re-matches prose-connective %) (re-matches prose-separator %)) after)
            rest-tokens (drop (count gap) after)
            before (reverse (take i tokens))
            bgap (take-while #(or (re-matches prose-connective %) (re-matches prose-separator %)) before)
            bword (first (drop (count bgap) before))
            after-values (when (some #(re-matches prose-separator %) gap)
                           (->> rest-tokens
                                (remove #(or (re-matches prose-connective %) (re-matches prose-separator %)))
                                (remove reference?)
                                (filter #(re-matches #"[\x21-\x7e]+" %))))
            after-values (if (and (= 1 (count after-values)) (setting? name (first after-values))) [] after-values)
            before-value (when (and bword (some #(re-matches #"(?i)is|are|was|were" %) bgap)
                                    (re-matches #"[\x21-\x7e]+" bword) (not (reference? bword))
                                    (not (re-matches prose-question bword)) (not (re-find loose-word bword)))
                           bword)
            values (cond-> (vec after-values) before-value (conj before-value))]
        (when (seq values)
          [(set (filter #(>= (count %) 4) (take max-prose-values values)))
           (or (some #(< (count %) 4) values) (> (count values) max-prose-values))])))))

(defn- prose-values
  "{:values vs} named by a secret word in prose, with {:reason \"value_exposure\"} when one is too short to pin."
  [text]
  (let [found (keep prose-line-values (take 4096 (str/split (str text) segment-break)))]
    (cond-> {:values (set (mapcat first found))}
      (some second found) (assoc :reason "value_exposure"))))

(def ^:dynamic *privacy-values* [])

;; Threat model and accepted residual: LANGFUSE_EXPORTER_THREAT_MODEL.md. A bare secret with no label, known format
;; or known source (a password alone in notes.txt) is indistinguishable from ordinary output and is sent: the Owner
;; accepted this residual for the in-cluster, Owner-only Langfuse (TD-07).
(defn- tool-exposure [tool result]
  (let [output (str (:output result))
        input (:input tool)
        input (if (string? input) input (json/generate-string input))]
    (cond (withhold-output? input) {:reason "sensitive_source"}
          (env-dump? output) {:reason "sensitive_source"}
          :else (let [in (exposure input) out (exposure output)
                      large? (> (count output) 262144)
                      ;; A value named in prose in the input (echo the password is huntertwo) is pinned too, so the
                      ;; bare output and later repeats are masked (P0 arch#14503 :580).
                      in-prose (when-not (> (count input) 262144) (prose-values input))
                      prose (when-not large? (prose-values output))]
                  (cond (:reason in) in
                        (:reason out) out
                        (:reason in-prose) {:reason (:reason in-prose)}
                        (:reason prose) {:reason (:reason prose)}
                        :else {:values (into (set (:values in)) (concat (:values out) (:values in-prose) (:values prose) (when-not large? (candidate-values output))))})))))

(defn- privacy-reason [tool result] (:reason (tool-exposure tool result)))
(defn- privacy-analysis [ctx gens tools-of result-of]
  (let [shared (or (:session-state ctx) (atom #{}))
        analysis (reduce (fn [state [idx gen]]
            (reduce (fn [state tool]
                      (let [{:keys [reason] found :values} (tool-exposure tool (result-of tool))
                            values (into (:values state) found)
                            reason (or reason (when (> (count values) max-session-values) "too_many_session_values"))]
                        (cond-> (assoc state :values values)
                          reason (update :first #(or % idx))
                          reason (assoc-in [:reasons tool] reason))))
                    state (tools-of gen)))
          {:values @shared :first nil :reasons {}} (map-indexed vector gens))]
    (reset! shared (:values analysis))
    analysis))
(defn- private-tool? [tool result] (boolean (privacy-reason tool result)))

(defn- tool-span [ctx {:keys [key parent name start end input output error? status private? hide-view? reason]}]
  (let [input-str (if (string? input) input (json/generate-string input))
        sensitive? (or (withhold-output? input-str) (env-dump? output))
        hide-view? (or hide-view? (= reason "too_many_session_values") (= reason "unscanned_large_output"))
        policy (cond sensitive? "withheld_sensitive_source" hide-view? "withheld_after_secret_exposure" :else "sent")]
    (assoc (mk-span ctx {:key key :parent parent :name (str "tool:" name) :start start :end end
                  :level (when error? "ERROR")
                  :attrs-map (cond-> {"langfuse.observation.type" "tool"
                                      "langfuse.observation.input" (if (or sensitive? hide-view?) withheld-model-output input-str)
                                      "langfuse.observation.output" (if (or sensitive? hide-view?) withheld-model-output (str (or output "")))
                                      "langfuse.observation.metadata.body_policy" policy}
                               private? (assoc "langfuse.observation.metadata.output_policy" withheld-model-output)
                               status (assoc "langfuse.observation.metadata.status" status)
                               error? (assoc "langfuse.observation.level" "ERROR"))})
           :session-values (if (or sensitive? hide-view?) #{} (set (:values (tool-exposure {:input input} {:output output}))))
           :private-reason (or reason (privacy-reason {:input input} {:output output})))))

(defn- generation-span [ctx {:keys [key parent model usage start end input output]}]
  (mk-span ctx {:key key :parent parent :name (str "generation:" (or model "unknown")) :start start :end end
                :attrs-map (cond-> {"langfuse.observation.type" "generation"
                                    "langfuse.observation.input" input
                                    "langfuse.observation.output" output
                                    "langfuse.observation.metadata.body_policy" (if (= input withheld-model-output) "withheld_after_secret_exposure" "sent")
                                    "langfuse.observation.metadata.input_scope" "delta"}
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

(defn claude-spans [ctx parent prefix lines]
  (let [results (claude-results lines)
        gens (claude-generations lines)
        end-of-log (some ->millis (reverse (map :timestamp lines)))
        analysis (privacy-analysis ctx gens #(filter (fn [tool] (= "tool_use" (:type tool))) (:blocks %)) #(get results (:id %)))
        first-sensitive (:first analysis)]
    (mapcat
     (fn [gen next-gen idx]
       (let [gen-key (str prefix "gen:" idx)
             tools (filter #(= "tool_use" (:type %)) (:blocks gen))
             end (or (:ts next-gen) end-of-log (:ts gen))
             output (str/join "\n" (concat [(content-text (:blocks gen))]
                                           (map #(str "[tool_use " (:name %) "]") tools)))]
         (cons
          (generation-span ctx {:key gen-key :parent parent :model (:model gen)
                                :usage (claude-usage (:usage gen)) :start (:ts gen) :end end
                                :input (if (and first-sensitive (> idx first-sensitive)) "[withheld: the model has seen tool output]" (:input gen)) :output (if (and first-sensitive (> idx first-sensitive)) "[withheld: the model has seen tool output]" (str/trim output))})
          (map (fn [tool]
                 (let [result (get results (:id tool))
                       later? (and first-sensitive (>= idx first-sensitive))]
                   (tool-span ctx {:key (str gen-key ":tool:" (:id tool)) :parent gen-key :name (:name tool)
                                   :start (:ts gen) :end (or (:ts result) end) :reason (get-in analysis [:reasons tool]) :private? (boolean (get-in analysis [:reasons tool])) :hide-view? later?
                                   :input (:input tool) :output (:output result) :error? (:error? result)})))
               tools))))
     gens (concat (rest gens) [nil]) (range))))

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
  (let [{:keys [gens results]} (codex-generations lines)
        end-of-log (some ->millis (reverse (map :timestamp lines)))
        analysis (privacy-analysis ctx gens :tools #(get results (:call-id %)))
        first-sensitive (:first analysis)]
    (mapcat
     (fn [gen next-gen idx]
       (let [gen-key (str prefix "gen:" idx)
             end (or (:ts next-gen) end-of-log (:ts gen))
             output (str/join "\n" (concat (:text gen) (map #(str "[tool_use " (:name %) "]") (:tools gen))))]
         (cons
          (generation-span ctx {:key gen-key :parent parent :model (:model gen) :usage (codex-usage (:usage gen))
                                :start (:ts gen) :end end :input (if (and first-sensitive (> idx first-sensitive)) "[withheld: the model has seen tool output]" (:input gen)) :output (if (and first-sensitive (> idx first-sensitive)) "[withheld: the model has seen tool output]" output)})
          (map (fn [tool]
                 (let [result (get results (:call-id tool))
                       later? (and first-sensitive (>= idx first-sensitive))]
                   (tool-span ctx {:key (str gen-key ":tool:" (:call-id tool)) :parent gen-key :name (:name tool)
                                   :start (:ts tool) :end (or (:ts result) end) :reason (get-in analysis [:reasons tool]) :private? (boolean (get-in analysis [:reasons tool])) :hide-view? later?
                                   :input (:input tool) :output (:output result) :status (:status tool) :error? (:error? tool)})))
               (:tools gen)))))
     gens (concat (rest gens) [nil]) (range))))

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

(defn build-run
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
                    "langfuse.trace.metadata.coverage.tool_body" "all_tools_masked_unless_secret_exposed"
                    "langfuse.trace.metadata.coverage.reasoning" "not_collected"
                    "langfuse.trace.metadata.coverage.provider_payload"
                    "partial: Claude api-request-blob and Codex response_item only; the CLI may add content it does not log"}
        pre-ctx {:tid tid :trace-attrs base-attrs :session-state (atom #{})}
        claude? (str/starts-with? agent-name "claude")
        claude (when claude? (binding [*privacy-values* (:secret-values cfg)] (let [v (claude-sources pre-ctx cfg ticket run)] (update v :spans vec))))
        events (when (fs/exists? (fs/path run-dir "events.jsonl")) (read-jsonl (fs/path run-dir "events.jsonl")))
        main-thread (:thread_id (first (filter #(= "thread.started" (:type %)) events)))
        delegation (json-file (fs/path run-dir "delegation.json"))
        delegate-thread (when (= "delegated" (:kind delegation)) (:thread delegation))
        threads (concat
                 (when main-thread [{:source "coverage.codex_session" :key "codex" :name "codex-session" :thread main-thread}])
                 (when delegate-thread [{:source "coverage.delegate" :key "delegate" :name "delegate:codex" :thread delegate-thread}])
                 (map-indexed (fn [i thread] {:source "coverage.review_gate" :key (str "review:" i) :name "review-gate" :thread thread})
                              (when (fs/directory? run-dir) (review-threads run-dir))))
        parts (binding [*privacy-values* (:secret-values cfg)] (mapv (fn [spec] (-> (codex-thread-spans pre-ctx cfg started spec) (assoc :source (:source spec)) (update :spans vec))) threads))
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
        private-span? (fn [span] (some #(= "langfuse.observation.metadata.output_policy" (:key %)) (:attributes span)))
        agent-ids (set (map :spanId (filter #(= "agent" (span-type %)) children0)))
        child-gen-ids (set (map :spanId (filter #(and (= "generation" (span-type %)) (agent-ids (:parentSpanId %))) children0)))
        child-span? (fn [span] (or (agent-ids (:parentSpanId span)) (child-gen-ids (:parentSpanId span))))
        run-private? (some private-span? children0)
        child-private? (some #(and (child-span? %) (private-span? %)) children0)
        main-gens (filter #(and (= "generation" (span-type %)) (not (child-span? %))) children0)
        later-main-gens (set (map :spanId (rest main-gens)))
        withhold-keys (fn [span keys]
                        (update span :attributes (fn [items] (mapv #(cond (contains? keys (:key %)) (assoc-in % [:value :stringValue] withheld-model-output)
                                                                            (and (= "langfuse.observation.metadata.body_policy" (:key %)) (not= "withheld_sensitive_source" (get-in % [:value :stringValue]))) (assoc-in % [:value :stringValue] "withheld_after_secret_exposure")
                                                                            :else %) items))))
        both #{"langfuse.observation.input" "langfuse.observation.output"}
        input-only #{"langfuse.observation.input"}
        body-span? (fn [span] (contains? body-tools (str/replace-first (:name span) #"^tool:" "")))
        ;; A child's first prompt can repeat what its parent read, and the parent can repeat what any child read.
        withhold-child (fn [span]
                         (case (span-type span)
                           "generation" (withhold-keys span both)
                           "tool" (withhold-keys span both)
                           span))
        withhold-main (fn [span]
                        (let [later? (later-main-gens (:parentSpanId span))]
                          (case (span-type span)
                            "generation" (if (later-main-gens (:spanId span)) (withhold-keys span both) span)
                            "tool" (cond (and (body-span? span) later?) (withhold-keys span both)
                                         (body-span? span) (withhold-keys span #{"langfuse.observation.output"})
                                         later? (withhold-keys span both)
                                         :else span)
                            span)))
        children (mapv (fn [span]
                         (cond (and run-private? (child-span? span)) (withhold-child span)
                               child-private? (withhold-main span)
                               :else span))
                       children0)
        first-reason (or (some :private-reason children0) "none")
        add-reason (fn [span] (update span :attributes conj (attr "langfuse.trace.metadata.coverage.withheld_reason" first-reason)))
        children (mapv add-reason children)
        root (add-reason root)
        sensitive? (some #(some (fn [a] (= withheld-model-output (get-in a [:value :stringValue]))) (:attributes %)) children)
        root (if sensitive?
               (update root :attributes (fn [items] (mapv #(if (= "langfuse.observation.output" (:key %))
                                                             (assoc-in % [:value :stringValue] "[withheld: the model has seen tool output]") %) items)))
               root)]
    {:ticket ticket :run run :trace-id tid
     :root root
     :spans (concat prompts children)
     :session-values @(:session-state pre-ctx)
     :candidate-overflow? (boolean (some #(= "too_many_session_values" (:private-reason %)) children0))
     :counts (merge (:counts claude) (frequencies (map (fn [span] (keyword (str "bodies_" (some #(when (= "langfuse.observation.metadata.body_policy" (:key %)) (get-in % [:value :stringValue])) (:attributes span))))) (filter #(#{"generation" "tool"} (span-type %)) children))))}))

;; ---------------------------------------------------------------- sanitizing

(def policy-values #{"sent" "withheld_sensitive_source" "withheld_after_secret_exposure" "all_tools_masked_unless_secret_exposed" "none" "sensitive_source" "value_exposure" "unscanned_large_output" "too_many_session_values"})

(defn- safe-policy-item? [cfg item]
  (let [value (get-in item [:value :stringValue])
        pattern (values-pattern (vec (:secret-values cfg)))]
    (and (#{"langfuse.observation.metadata.body_policy" "langfuse.trace.metadata.coverage.tool_body" "langfuse.trace.metadata.coverage.withheld_reason"} (:key item))
         (policy-values value)
         (not (and pattern (re-find pattern value))))))

(defn sanitize-span
  "Every exported string goes through redaction before truncation, so a cut can never hide a
  secret from the mask. A failure in here costs the field, not the fail-closed property."
  [cfg tally span]
  (let [clean (fn [s]
                (let [{:keys [value redactions]} (*redact-field* s (:secret-values cfg))]
                  (when (seq redactions) (swap! tally #(merge-with + % redactions)))
                  (truncate-field value (:max-field-bytes cfg))))]
    (-> span
        (dissoc :session-values :private-reason)
        (update :name clean)
        (update :attributes
                (fn [items]
                  (mapv (fn [item]
                          (if (safe-policy-item? cfg item) item
                            (update item :value #(walk/postwalk (fn [x] (if (string? x) (clean x) x)) %))))
                        items))))))

(defn span-safe?
  "The final guard. It covers every string in the span, whatever the per-field pass did."
  [cfg span]
  (let [items (remove #(safe-policy-item? cfg %) (:attributes span))
        strings (concat [(:name span)] (filter string? (tree-seq coll? seq (map :value items))))]
    (every? #(guard-safe? % (:secret-values cfg)) strings)))

(defn prepare-spans
  "Returns {:spans :stats}: sanitized, capped and final-guarded spans (root first), or
  :failed when the root itself does not pass the guard."
  [cfg {:keys [root spans session-values candidate-overflow?]}]
  (let [cfg (update cfg :secret-values into session-values)
        spans (map #(dissoc % :session-values :private-reason) spans)
        tally (atom {})
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
                     (pos? guard-drops) (update :attributes conj (attr "langfuse.trace.metadata.coverage.dropped_secret_guard" (str guard-drops))))]
    (if (and (not candidate-overflow?) (span-safe? cfg clean-root))
      {:spans (into [clean-root] kept)
       :stats {:redactions @tally :dropped-secret-guard guard-drops :bytes bytes :truncated truncated?}}
      {:failed (if candidate-overflow? "too_many_session_values" "secret_guard_root")
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
  (let [run-data (build-run cfg ticket run)
        {:keys [spans failed stats]} (prepare-spans cfg run-data)
        type-of (fn [span] (or (some (fn [a] (when (= "langfuse.observation.type" (:key a)) (get-in a [:value :stringValue])))
                                     (:attributes span))
                               "span"))]
    {:failed failed
     :counts (:counts run-data)
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
