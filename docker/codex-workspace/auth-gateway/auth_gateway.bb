#!/usr/bin/env bb

;; BOXP-634: スマートフォンのブラウザから、Owner 本人が AI CLI の公式ログインを行うための
;; 限定認証ページ (codex-auth.b0xp.io)。
;;
;; 守ること:
;; - 起動できるのは固定のログインコマンド 3 つだけ（汎用シェルや任意コマンドは起動しない）。
;;   Antigravity: 対話 `agy`（login 専用 subcommand が無いため）/ Claude: `claude auth login
;;   --claudeai` / Codex: `codex login --device-auth`。
;; - 全リクエスト (WebSocket upgrade を含む) で Cloudflare Access JWT の署名・aud・iss・期限と
;;   Owner の email を検証する。cloudflared 側の Access 検証に加えた二重の確認で、設定が欠けて
;;   いれば全拒否 (fail closed)。状態変更 (WebSocket / POST) は Origin も一致を要求する。
;; - 子プロセスの環境変数は allowlist。API 鍵・ADC・トークン系の変数は渡さない（課金経路へ
;;   切り替わらない）。資格情報ファイルはこのプロセスでは読まない。
;; - 端末の入出力はメモリ上だけで扱い、ログ・ファイルへ保存しない。ログに残すのは provider と
;;   開始/終了の理由だけ。
;; - 同時に動くログインは 1 つ（排他）。無操作・最大時間・停止要求で process group ごと終了する。
;; - ログイン操作と成功確認は分ける。確認は BOXP-204 の agent_auth_expiry.bb の
;;   非秘密メタデータだけを表示し、「実利用の成功」とは表示しない。

(ns auth-gateway
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [cheshire.core :as json]
            [clojure.string :as str]
            [org.httpkit.client :as http]
            [org.httpkit.server :as server])
  (:import [java.math BigInteger]
           [java.security KeyFactory Signature]
           [java.security.spec X509EncodedKeySpec]
           [java.util Base64]))

;; ---- config ----

(defn env [k default]
  (let [v (System/getenv k)]
    (if (str/blank? v) default v)))

(defn parse-long-or [s default]
  (try (Long/parseLong (str s)) (catch Exception _ default)))

(defn load-config []
  {:port (parse-long-or (env "CODEX_AUTH_GATEWAY_PORT" "8095") 8095)
   :bind (env "CODEX_AUTH_GATEWAY_BIND" "0.0.0.0")
   :team-domain (some-> (env "CODEX_AUTH_GATEWAY_TEAM_DOMAIN" nil) (str/replace #"/+$" ""))
   :aud (env "CODEX_AUTH_GATEWAY_AUD" nil)
   :owner-emails (->> (str/split (env "CODEX_AUTH_GATEWAY_OWNER_EMAILS" "") #"[,\s]+")
                      (remove str/blank?)
                      (map str/lower-case)
                      set)
   :public-origin (some-> (env "CODEX_AUTH_GATEWAY_PUBLIC_ORIGIN" nil) (str/replace #"/+$" ""))
   :idle-seconds (parse-long-or (env "CODEX_AUTH_GATEWAY_IDLE_SECONDS" "600") 600)
   :max-seconds (parse-long-or (env "CODEX_AUTH_GATEWAY_MAX_SECONDS" "1200") 1200)
   :home (env "HOME" "/home/boxp")
   :task-board-root (env "CODEX_TASK_BOARD_ROOT" "/home/boxp/.codex-task-board")
   :static-dir (env "CODEX_AUTH_GATEWAY_STATIC_DIR"
                    (str (fs/path (fs/parent (fs/canonicalize *file*)) "static")))
   :auth-module (env "CODEX_AUTH_GATEWAY_AUTH_MODULE"
                     "/opt/codex-workspace/task-board/agent_auth_expiry.bb")})

(defn config-ready?
  "Every value the JWT check needs is present; otherwise everything is denied."
  [{:keys [team-domain aud owner-emails public-origin]}]
  (boolean (and (some? team-domain) (str/starts-with? team-domain "https://")
                (some? aud) (seq owner-emails)
                (some? public-origin) (str/starts-with? public-origin "https://"))))

(defn log [& parts]
  (binding [*out* *err*]
    (println (str (java.time.Instant/now) " auth-gateway: " (str/join " " parts)))))

;; ---- fixed login commands ----

;; Absolute paths of the image's pinned CLIs. Tests replace this atom; production
;; never reads commands from the request or the environment.
(def commands
  (atom {"antigravity" {:label "Antigravity CLI (agy)" :argv ["/usr/local/bin/agy"]}
         "claude" {:label "Claude Code" :argv ["/usr/bin/claude" "auth" "login" "--claudeai"]}
         "codex" {:label "Codex CLI" :argv ["/usr/bin/codex" "login" "--device-auth"]}}))

;; Only these variables reach the CLI. API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY,
;; GEMINI_API_KEY, GOOGLE_API_KEY), ADC (GOOGLE_APPLICATION_CREDENTIALS), OAuth token
;; variables and cluster secrets are therefore never passed on.
(def child-env-allowlist ["HOME" "USER" "LOGNAME" "PATH" "LANG" "LC_ALL" "TZ" "CODEX_HOME"])

(defn child-env [parent]
  (merge (select-keys parent child-env-allowlist)
         {"TERM" "xterm-256color" "COLORTERM" "truecolor" "SHELL" "/bin/bash"}))

(defn- shell-quote [s] (str "'" (str/replace s "'" "'\\''") "'"))

(defn clamp [n lo hi] (max lo (min hi n)))

(defn pty-argv
  "`script` gives the CLI a real terminal. The command string is built only from
  the fixed argv and two clamped integers."
  [argv cols rows]
  (let [cols (clamp cols 20 300) rows (clamp rows 8 120)]
    ["setsid" "script" "-qfec"
     (str "stty cols " cols " rows " rows " 2>/dev/null; exec " (str/join " " (map shell-quote argv)))
     "/dev/null"]))

;; ---- Cloudflare Access JWT ----

(defn b64url-decode ^bytes [^String s]
  (.decode (Base64/getUrlDecoder) s))

(defn- parse-json-bytes [^bytes b]
  (json/parse-string (String. b "UTF-8")))

;; babashka does not ship RSAPublicKeySpec, so the JWK (n, e) is wrapped into a
;; DER SubjectPublicKeyInfo and read through X509EncodedKeySpec.
(defn- der-length [n]
  (if (< n 128)
    [n]
    (let [bs (loop [n n acc ()] (if (zero? n) acc (recur (bit-shift-right n 8) (conj acc (bit-and n 0xff)))))]
      (into [(bit-or 0x80 (count bs))] bs))))

(defn- der [tag ^bytes body]
  (byte-array (concat [tag] (map unchecked-byte (der-length (alength body))) body)))

(defn- der-seq [& parts] (der 0x30 (byte-array (mapcat seq parts))))

(defn- der-int [^bytes unsigned]
  ;; Positive INTEGER: a leading 0x00 keeps the sign bit clear.
  (der 0x02 (byte-array (cons 0 (seq unsigned)))))

(def ^:private rsa-algorithm-id
  ;; SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }
  (byte-array (map unchecked-byte [0x30 0x0d 0x06 0x09 0x2a 0x86 0x48 0x86 0xf7 0x0d 0x01 0x01 0x01 0x05 0x00])))

(defn rsa-public-key [{:strs [n e]}]
  (let [rsa-key (der-seq (der-int (b64url-decode n)) (der-int (b64url-decode e)))
        bit-string (der 0x03 (byte-array (cons 0 (seq rsa-key))))]
    (.generatePublic (KeyFactory/getInstance "RSA")
                     (X509EncodedKeySpec. (der-seq rsa-algorithm-id bit-string)))))

(def certs-cache (atom {:fetched-at 0 :keys {}}))

(defn fetch-certs
  "kid -> JWK map from <team-domain>/cdn-cgi/access/certs."
  [team-domain]
  (let [{:keys [status body]} @(http/get (str team-domain "/cdn-cgi/access/certs") {:timeout 10000})]
    (when (= 200 status)
      (into {} (for [k (get (json/parse-string body) "keys")
                     :when (and (= "RSA" (get k "kty")) (get k "kid"))]
                 [(get k "kid") k])))))

(def ^:dynamic *fetch-certs* fetch-certs)

(defn signing-key
  "Cached for 10 minutes; an unknown kid refetches at most every 30 seconds."
  [team-domain kid now-ms]
  (let [{:keys [fetched-at keys]} @certs-cache
        age (- now-ms fetched-at)]
    (or (and (< age 600000) (get keys kid))
        (when (or (>= age 30000) (empty? keys))
          (when-let [fresh (try (*fetch-certs* team-domain) (catch Exception _ nil))]
            (reset! certs-cache {:fetched-at now-ms :keys fresh})
            (get fresh kid))))))

(defn verify-jwt
  "The verified email (lower case) when the token is a valid Access token for
  this application and an Owner; otherwise nil. Reasons are not returned so a
  caller cannot echo token details."
  [token {:keys [team-domain aud owner-emails] :as cfg} now-ms]
  (when (and (config-ready? cfg) (string? token) (< (count token) 16384))
    (try
      (let [[h pl sig :as parts] (str/split token #"\.")
            _ (when-not (= 3 (count parts)) (throw (ex-info "shape" {})))
            header (parse-json-bytes (b64url-decode h))
            payload (parse-json-bytes (b64url-decode pl))
            jwk (when (= "RS256" (get header "alg"))
                  (signing-key team-domain (get header "kid") now-ms))]
        (when jwk
          (let [verifier (doto (Signature/getInstance "SHA256withRSA")
                           (.initVerify (rsa-public-key jwk))
                           (.update (.getBytes (str h "." pl) "US-ASCII")))
                now-s (quot now-ms 1000)
                auds (let [a (get payload "aud")] (if (string? a) [a] a))
                email (some-> (get payload "email") str/lower-case)
                exp (get payload "exp")
                nbf (get payload "nbf")]
            (when (and (.verify verifier (b64url-decode sig))
                       (= team-domain (get payload "iss"))
                       (sequential? auds) (some #{aud} auds)
                       (number? exp) (< now-s (+ exp 30))
                       (or (nil? nbf) (and (number? nbf) (<= nbf (+ now-s 30))))
                       (contains? owner-emails email))
              email))))
      (catch Exception _ nil))))

;; ---- login session (at most one) ----

(def max-buffer-chars (* 256 1024))
(def max-input-chars 4096)

(defonce session (atom nil))

(defn- now-ms [] (System/currentTimeMillis))

(defn send-json! [ch m]
  (try (server/send! ch (json/generate-string m)) (catch Exception _ nil)))

(defn broadcast! [s m]
  (doseq [ch @(:channels s)] (send-json! ch m)))

(defn- clear-buffer! [s]
  (locking (:buffer s) (.setLength ^StringBuilder (:buffer s) 0)))

(defn end-session!
  "Kill the whole process group of the login and forget its output."
  [s reason]
  (when (compare-and-set! (:ended s) false true)
    (try (p/destroy-tree (:proc s)) (catch Exception _ nil))
    (let [code (try (deref (:proc s) 3000 nil) (catch Exception _ nil))
          code (when (map? code) (:exit code))]
      (log "session end" (str "provider=" (:provider s)) (str "reason=" (name reason))
           (str "exit=" (if (some? code) code "unknown")))
      (broadcast! s {:t "exit" :reason (name reason) :code code})
      (doseq [ch @(:channels s)] (try (server/close ch) (catch Exception _ nil)))
      (clear-buffer! s)
      (compare-and-set! session s nil))))

(defn- pump-output!
  "PTY output -> bounded in-memory buffer (for re-attach after the phone came
  back from the browser tab) and every attached socket. Never written anywhere."
  [s]
  (future
    (try
      (with-open [r (java.io.InputStreamReader. ^java.io.InputStream (:out (:proc s)) "UTF-8")]
        (let [buf (char-array 4096)]
          (loop []
            (let [n (.read r buf)]
              (when (pos? n)
                (let [chunk (String. buf 0 n)
                      ^StringBuilder sb (:buffer s)]
                  (locking sb
                    (.append sb chunk)
                    (when (> (.length sb) max-buffer-chars)
                      (.delete sb 0 (- (.length sb) max-buffer-chars))))
                  (broadcast! s {:t "out" :d chunk}))
                (recur))))))
      (catch Exception _ nil))
    (end-session! s :process-exit)))

(defn start-session!
  "nil when another login is running (the exclusive lock), else the session."
  [provider cols rows {:keys [home]}]
  (when-let [{:keys [argv]} (get @commands provider)]
    (let [placeholder {:provider provider :ended (atom false)}]
      (when (compare-and-set! session nil placeholder)
        (try
          (let [proc (p/process {:cmd (pty-argv argv cols rows)
                                 :dir home
                                 :env (child-env (into {} (System/getenv)))
                                 :err (java.io.File. "/dev/null")})
                t (now-ms)
                s {:id (str (random-uuid)) :provider provider :proc proc
                   :started-at t :last-input (atom t) :ended (atom false)
                   :buffer (StringBuilder.) :channels (atom #{})}]
            (reset! session s)
            (log "session start" (str "provider=" provider))
            (pump-output! s)
            s)
          (catch Exception _
            (compare-and-set! session placeholder nil)
            nil))))))

(defn write-input! [s ^String d]
  (when (and (string? d) (<= (count d) max-input-chars) (not @(:ended s)))
    (reset! (:last-input s) (now-ms))
    (try (let [^java.io.OutputStream in (:in (:proc s))]
           (.write in (.getBytes d "UTF-8"))
           (.flush in))
         (catch Exception _ nil))))

(defn reap!
  "Idle (no input and no attached screen activity) and hard limits."
  [{:keys [idle-seconds max-seconds]} t]
  (when-let [s @session]
    (when (:proc s)
      (cond
        (> (- t (:started-at s)) (* 1000 max-seconds)) (end-session! s :max-duration)
        (> (- t @(:last-input s)) (* 1000 idle-seconds)) (end-session! s :idle)))))

;; ---- status (separate from the login itself) ----

(defn auth-status
  "Non-secret metadata from BOXP-204's agent_auth_expiry.bb, plus whether a
  login is running. It cannot prove that the next real run will succeed."
  [{:keys [auth-module task-board-root]}]
  (let [snap (try (when (fs/exists? auth-module)
                    (load-file auth-module)
                    ((resolve 'agent-auth-expiry/write-metrics!) task-board-root)
                    ((resolve 'agent-auth-expiry/snapshot) task-board-root))
                  (catch Exception _ nil))
        now-s (quot (now-ms) 1000)]
    {:checked_at now-s
     :login_running (some-> @session :provider)
     :providers (vec (for [{:keys [provider state relogin-deadline last-refresh
                                   run-auth-failure run-success]} snap]
                       (cond-> {:provider provider :metadata state}
                         relogin-deadline (assoc :relogin_in_hours (quot (- relogin-deadline now-s) 3600))
                         last-refresh (assoc :last_refresh_hours_ago (quot (- now-s last-refresh) 3600))
                         run-auth-failure (assoc :last_run_auth_failure_at run-auth-failure)
                         run-success (assoc :last_run_success_at run-success))))}))

;; ---- HTTP ----

(def security-headers
  {"Cache-Control" "no-store"
   "X-Content-Type-Options" "nosniff"
   "Referrer-Policy" "no-referrer"
   "X-Frame-Options" "DENY"
   "Content-Security-Policy" (str "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                                  "connect-src 'self'; img-src 'self' data:; font-src 'self'; "
                                  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")})

(defn respond
  ([status body] (respond status "text/plain; charset=utf-8" body))
  ([status ctype body]
   {:status status :headers (assoc security-headers "Content-Type" ctype) :body body}))

(defn json-response [status m]
  (respond status "application/json; charset=utf-8" (json/generate-string m)))

(def static-files
  {"/" ["index.html" "text/html; charset=utf-8"]
   "/static/app.js" ["app.js" "text/javascript; charset=utf-8"]
   "/static/app.css" ["app.css" "text/css; charset=utf-8"]
   "/static/xterm.js" ["vendor/xterm.js" "text/javascript; charset=utf-8"]
   "/static/xterm.css" ["vendor/xterm.css" "text/css; charset=utf-8"]
   "/static/addon-fit.js" ["vendor/addon-fit.js" "text/javascript; charset=utf-8"]})

(defn same-origin? [req {:keys [public-origin]}]
  (= public-origin (get-in req [:headers "origin"])))

(defn authenticated-email [req cfg]
  (verify-jwt (get-in req [:headers "cf-access-jwt-assertion"]) cfg (now-ms)))

(defn ws-handler [req cfg]
  (let [q (into {} (for [kv (str/split (or (:query-string req) "") #"&")
                         :let [[k v] (str/split kv #"=" 2)] :when (seq k)]
                     [k (java.net.URLDecoder/decode (or v "") "UTF-8")]))
        provider (get q "provider")
        cols (parse-long-or (get q "cols") 80)
        rows (parse-long-or (get q "rows") 24)
        ;; A re-attach (after the OAuth tab, or a reload) must never start a new login.
        attach-only? (= "1" (get q "attach"))]
    (server/as-channel
     req
     {:on-open
      (fn [ch]
        (let [current @session
              s (cond
                  (and current (:proc current) (= provider (:provider current))) current
                  (and (nil? current) (not attach-only?)) (start-session! provider cols rows cfg)
                  :else nil)]
          (if-not (and s (:proc s))
            (do (send-json! ch {:t "error" :msg (cond current "busy" attach-only? "ended" :else "unavailable")
                                :running (:provider current)})
                (server/close ch))
            (do (swap! (:channels s) conj ch)
                (reset! (:last-input s) (now-ms))
                (send-json! ch {:t "attached" :provider (:provider s)})
                (let [replay (locking (:buffer s) (str (:buffer s)))]
                  (when (seq replay) (send-json! ch {:t "out" :d replay})))))))
      :on-receive
      (fn [ch msg]
        (when-let [s @session]
          (when (contains? @(:channels s) ch)
            (let [m (try (json/parse-string msg) (catch Exception _ nil))]
              (case (get m "t")
                "in" (write-input! s (get m "d"))
                "stop" (end-session! s :stopped-by-owner)
                "ping" (send-json! ch {:t "pong"})
                nil)))))
      :on-close
      (fn [ch _status]
        ;; The login keeps running while the Owner is in the OAuth tab; the
        ;; idle / max limits end it if they never come back.
        (when-let [s @session]
          (when (:channels s) (swap! (:channels s) disj ch))))})))

(defn handler [cfg]
  (fn [req]
    (let [uri (:uri req) method (:request-method req)]
      (cond
        (= uri "/healthz") (respond 200 "ok")
        (not (config-ready? cfg)) (respond 503 "not configured")
        (nil? (authenticated-email req cfg)) (respond 403 "forbidden")
        (= uri "/ws")
        (if (and (:websocket? req) (same-origin? req cfg)) (ws-handler req cfg) (respond 403 "forbidden"))
        (and (= method :get) (= uri "/api/status")) (json-response 200 (auth-status cfg))
        (and (= method :get) (= uri "/api/session"))
        (json-response 200 {:running (some-> @session :provider)
                            :providers (into (sorted-map) (for [[k v] @commands] [k (:label v)]))})
        (and (= method :post) (= uri "/api/session/stop"))
        (if (same-origin? req cfg)
          (do (when-let [s @session] (when (:proc s) (end-session! s :stopped-by-owner)))
              (json-response 200 {:running nil}))
          (respond 403 "forbidden"))
        (and (= method :get) (contains? static-files uri))
        (let [[f ctype] (get static-files uri)
              path (fs/path (:static-dir cfg) f)]
          (if (fs/exists? path) (respond 200 ctype (fs/file path)) (respond 404 "not found")))
        :else (respond 404 "not found")))))

(defn serve! [cfg]
  (when-not (config-ready? cfg)
    (log "missing CODEX_AUTH_GATEWAY_TEAM_DOMAIN / AUD / OWNER_EMAILS / PUBLIC_ORIGIN: every request is denied"))
  (let [stop (server/run-server (handler cfg) {:ip (:bind cfg) :port (:port cfg)
                                               :max-body 65536 :max-ws 65536})]
    (log "listening" (str (:bind cfg) ":" (:port cfg)))
    (future (loop [] (Thread/sleep 5000) (try (reap! cfg (now-ms)) (catch Exception _ nil)) (recur)))
    stop))

(when (= (str (fs/canonicalize *file*)) (some-> (System/getProperty "babashka.file") fs/canonicalize str))
  (let [cfg (load-config)
        stop (serve! cfg)]
    (-> (Runtime/getRuntime)
        (.addShutdownHook (Thread. (fn []
                                     (when-let [s @session] (when (:proc s) (end-session! s :shutdown)))
                                     (stop)))))
    @(promise)))
