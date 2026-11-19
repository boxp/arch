#!/usr/bin/env bb
;; BOXP-634: tests for docker/codex-workspace/auth-gateway/auth_gateway.bb
;; No network and no real CLI: Access certs come from a generated RSA key and the
;; "login command" is a fake script.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str]
         '[clojure.test :refer [deftest is testing run-tests]])

(def repo (-> *file* fs/canonicalize fs/parent fs/parent fs/parent))
(load-file (str (fs/path repo "docker/codex-workspace/auth-gateway/auth_gateway.bb")))
(alias 'ag 'auth-gateway)
(def production-commands @ag/commands)

(import '[java.security KeyPairGenerator Signature]
        '[java.util Base64])

(def kp (.generateKeyPair (doto (KeyPairGenerator/getInstance "RSA") (.initialize 2048))))
(def other-kp (.generateKeyPair (doto (KeyPairGenerator/getInstance "RSA") (.initialize 2048))))

(defn b64url [^bytes b] (.encodeToString (.withoutPadding (Base64/getUrlEncoder)) b))

(def team "https://boxp.cloudflareaccess.com")
(def aud "test-aud-0123")
(def cfg {:team-domain team :aud aud :owner-emails #{"owner@example.com"}
          :public-origin "https://codex-auth.example.test"
          :idle-seconds 600 :max-seconds 1200 :home (System/getProperty "user.home")
          :auth-module "/nonexistent" :task-board-root "/nonexistent"
          :static-dir (str (fs/path repo "docker/codex-workspace/auth-gateway/static"))})

;; babashka cannot call RSAPublicKey getters: take n and e from the fixed
;; SubjectPublicKeyInfo layout of a 2048-bit key with e = 65537.
(def spki (.getEncoded (.getPublic kp)))
(assert (= 294 (count spki)))
(def jwk {"kty" "RSA" "kid" "k1"
          "n" (b64url (java.util.Arrays/copyOfRange spki 33 289))
          "e" (b64url (java.util.Arrays/copyOfRange spki 291 294))})

(defn token
  ([claims] (token claims {}))
  ([claims {:keys [alg kid key] :or {alg "RS256" kid "k1" key (.getPrivate kp)}}]
   (let [h (b64url (.getBytes (json/generate-string {"alg" alg "kid" kid "typ" "JWT"}) "UTF-8"))
         p (b64url (.getBytes (json/generate-string claims) "UTF-8"))
         s (b64url (.sign (doto (Signature/getInstance "SHA256withRSA")
                            (.initSign key)
                            (.update (.getBytes (str h "." p) "US-ASCII")))))]
     (str h "." p "." s))))

(def now-ms (System/currentTimeMillis))
(def now-s (quot now-ms 1000))
(def good {"aud" [aud] "iss" team "email" "Owner@Example.com" "exp" (+ now-s 600) "iat" now-s "nbf" now-s})

(defn with-certs [f]
  ;; Seeded (not only bound): http-kit handler threads do not see the binding.
  (reset! ag/certs-cache {:fetched-at (System/currentTimeMillis) :keys {"k1" jwk}})
  (binding [ag/*fetch-certs* (fn [_] {"k1" jwk})] (f)))

(deftest jwt-verification
  (with-certs
    (fn [] (do
       (is (= "owner@example.com" (ag/verify-jwt (token good) cfg now-ms)) "valid Owner token")
       (is (nil? (ag/verify-jwt (token (assoc good "aud" ["other"])) cfg now-ms)) "wrong aud")
       (is (nil? (ag/verify-jwt (token (assoc good "iss" "https://evil.cloudflareaccess.com")) cfg now-ms)) "wrong iss")
       (is (nil? (ag/verify-jwt (token (assoc good "exp" (- now-s 120))) cfg now-ms)) "expired")
       (is (nil? (ag/verify-jwt (token (assoc good "nbf" (+ now-s 600))) cfg now-ms)) "not yet valid")
       (is (nil? (ag/verify-jwt (token (assoc good "email" "someone@example.com")) cfg now-ms)) "not the Owner")
       (is (nil? (ag/verify-jwt (token (dissoc good "email")) cfg now-ms)) "no email (service token)")
       (is (nil? (ag/verify-jwt (token good {:key (.getPrivate other-kp)}) cfg now-ms)) "bad signature")
       (is (nil? (ag/verify-jwt (token good {:kid "unknown"}) cfg now-ms)) "unknown kid")
       (is (nil? (ag/verify-jwt (token good {:alg "HS256"}) cfg now-ms)) "alg other than RS256")
       (let [[h p] (str/split (token good) #"\.")]
         (is (nil? (ag/verify-jwt (str h "." p ".") cfg now-ms)) "alg none style / empty signature"))
       (is (nil? (ag/verify-jwt "garbage" cfg now-ms)))
       (is (nil? (ag/verify-jwt nil cfg now-ms)))
       (is (nil? (ag/verify-jwt (token good) (assoc cfg :aud nil) now-ms)) "fail closed without AUD")))))

(defn req [m] (merge {:request-method :get :uri "/" :headers {}} m))

(deftest http-gating
  (with-certs
    (fn [] (let [h (ag/handler cfg)
           auth {"cf-access-jwt-assertion" (token good)}]
       (is (= 200 (:status (h (req {:uri "/healthz"})))))
       (is (= 403 (:status (h (req {:uri "/api/session"})))) "no JWT")
       (is (= 403 (:status (h (req {:uri "/api/session" :headers {"cf-access-jwt-assertion" (token (assoc good "email" "x@example.com"))}})))))
       (is (= 200 (:status (h (req {:uri "/api/session" :headers auth})))))
       (is (= 200 (:status (h (req {:uri "/" :headers auth})))))
       (is (= "no-store" (get-in (h (req {:uri "/" :headers auth})) [:headers "Cache-Control"])))
       (is (= 404 (:status (h (req {:uri "/../auth_gateway.bb" :headers auth})))) "only fixed static files")
       (is (= 403 (:status (h (req {:request-method :post :uri "/api/session/stop" :headers auth})))) "POST without Origin")
       (is (= 403 (:status (h (req {:request-method :post :uri "/api/session/stop"
                                    :headers (assoc auth "origin" "https://evil.example")})))))
       (is (= 200 (:status (h (req {:request-method :post :uri "/api/session/stop"
                                    :headers (assoc auth "origin" (:public-origin cfg))})))))
       (is (= 403 (:status (h (req {:uri "/ws" :websocket? true :headers (assoc auth "origin" "https://evil.example")})))))
       (is (= 503 (:status ((ag/handler (assoc cfg :owner-emails #{})) (req {:uri "/" :headers auth})))) "unconfigured")))))

(deftest child-environment
  (let [e (ag/child-env {"HOME" "/home/boxp" "PATH" "/usr/bin" "ANTHROPIC_API_KEY" "x" "OPENAI_API_KEY" "x"
                         "GEMINI_API_KEY" "x" "GOOGLE_API_KEY" "x" "GOOGLE_APPLICATION_CREDENTIALS" "/x"
                         "CLAUDE_CODE_OAUTH_TOKEN" "x" "GRAFANA_SERVICE_ACCOUNT_TOKEN" "x" "KUBECONFIG" "/x"})]
    (is (= #{"HOME" "PATH" "TERM" "COLORTERM" "SHELL"} (set (keys e))))))

(deftest fixed-commands
  (is (= #{"antigravity" "claude" "codex"} (set (keys production-commands))))
  (is (= ["/usr/bin/claude" "auth" "login" "--claudeai"] (:argv (get production-commands "claude"))) "subscription login, not Console/API")
  (is (= ["/usr/bin/codex" "login" "--device-auth"] (:argv (get production-commands "codex"))))
  (let [argv (ag/pty-argv ["/bin/x" "a'b"] 9999 -5)]
    (is (= ["setsid" "script" "-qfec"] (take 3 argv)))
    (is (str/includes? (nth argv 3) "stty cols 300 rows 8"))
    (is (str/includes? (nth argv 3) "exec '/bin/x' 'a'\\''b'"))))

(def tmp (fs/create-temp-dir {:prefix "auth-gateway-test-"}))
(def fake-cli (str (fs/path tmp "fake-cli.sh")))
(spit fake-cli (str "#!/bin/bash\n"
                    "echo \"env-key=${GEMINI_API_KEY:-none} tty=$(tty >/dev/null && echo yes)\"\n"
                    "echo 'Open https://login.example.test/oauth?state=abc'\n"
                    "read -r code\n"
                    "echo \"got-code-len=${#code}\"\n"))
(fs/set-posix-file-permissions fake-cli "rwx------")

(defn wait-until [pred ms]
  (loop [t 0] (cond (pred) true (> t ms) false :else (do (Thread/sleep 50) (recur (+ t 50))))))

(deftest session-lifecycle-and-exclusion
  (reset! ag/commands {"codex" {:label "fake" :argv [fake-cli]} "claude" {:label "fake2" :argv ["/bin/sleep" "60"]}})
  (let [s (ag/start-session! "codex" 80 24 cfg)]
    (is (some? s))
    (is (nil? (ag/start-session! "claude" 80 24 cfg)) "second login refused while one runs")
    (is (nil? (ag/start-session! "unknown" 80 24 cfg)))
    (is (wait-until #(str/includes? (str (:buffer s)) "https://login.example.test") 5000))
    (is (str/includes? (str (:buffer s)) "env-key=none tty=yes") "real tty, no API key passed")
    (ag/write-input! s "secret-code-123\r")
    (is (wait-until #(nil? @ag/session) 5000) "session ends when the CLI exits")
    (is (= 0 (.length ^StringBuilder (:buffer s))) "output is dropped after the end"))
  (testing "stop kills the process tree; idle and max limits"
    (let [s (ag/start-session! "claude" 80 24 cfg)
          pid (.pid ^Process (:proc (:proc s)))]
      (is (some? s))
      (ag/reap! (assoc cfg :idle-seconds 0) (+ (System/currentTimeMillis) 5000))
      (is (wait-until #(nil? @ag/session) 5000) "idle limit")
      (is (wait-until #(let [h (java.lang.ProcessHandle/of pid)] (or (not (.isPresent h)) (not (.isAlive (.get h))))) 5000)))
    (let [s (ag/start-session! "claude" 80 24 cfg)]
      (ag/reap! (assoc cfg :max-seconds 0) (+ (System/currentTimeMillis) 5000))
      (is (wait-until #(nil? @ag/session) 5000) "max limit")
      (is @(:ended s)))))

(deftest websocket-end-to-end
  (reset! ag/commands {"codex" {:label "fake" :argv [fake-cli]}})
  (with-certs
    (fn [] (let [port (+ 20000 (rand-int 20000))
           stop (org.httpkit.server/run-server (ag/handler cfg) {:ip "127.0.0.1" :port port})
           got (atom "") closed (promise)
           client (java.net.http.HttpClient/newHttpClient)
           listener (reify java.net.http.WebSocket$Listener
                      (onOpen [_ ws] (.request ws 1))
                      (onText [_ ws data _last]
                        (swap! got str data) (.request ws 1) nil)
                      (onClose [_ _ws _code _reason] (deliver closed true) nil)
                      (onError [_ _ws _e] (deliver closed :error)))
           connect (fn [q tok]
                     (-> (.newWebSocketBuilder client)
                         (.header "Cf-Access-Jwt-Assertion" tok)
                         (.header "Origin" (:public-origin cfg))
                         (.buildAsync (java.net.URI. (str "ws://127.0.0.1:" port "/ws?" q)) listener)
                         (.get 5 java.util.concurrent.TimeUnit/SECONDS)))]
       (try
         (is (thrown? Exception (connect "provider=codex" (token (assoc good "email" "x@example.com"))))
             "non-Owner cannot open the socket")
         (is (nil? @ag/session))
         (let [ws (connect "provider=codex&attach=1" (token good))]
           (is (wait-until #(str/includes? @got "\"ended\"") 3000) "attach never starts a login")
           (is (nil? @ag/session)))
         (reset! got "")
         (let [ws (connect "provider=codex&cols=60&rows=20" (token good))]
           (is (wait-until #(str/includes? @got "login.example.test") 5000))
           (.get (.sendText ws (json/generate-string {:t "in" :d "abc\r"}) true))
           (is (wait-until #(str/includes? @got "\"exit\"") 5000))
           (is (str/includes? @got "got-code-len=3")))
         (finally (stop)))))))

(let [{:keys [fail error]} (run-tests)]
  (fs/delete-tree tmp)
  (shutdown-agents)
  (System/exit (if (zero? (+ fail error)) 0 1)))
