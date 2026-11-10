#!/usr/bin/env bb
(require '[babashka.fs :as fs] '[babashka.process :as p] '[clojure.edn :as edn] '[cheshire.core :as json] '[clojure.string :as str])
(def root (str (fs/create-temp-dir {:prefix "model-updates-test-"})))
(def script (str (fs/absolutize "docker/codex-workspace/model-updates/model_updates.bb")))
(def catalog (str root "/catalog.edn"))
(fs/copy "docker/codex-workspace/model-catalog.edn" catalog)
(def fake (str root "/claude"))
(spit fake "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 2.1.321; exit 0; fi\n[ -z \"${ANTHROPIC_API_KEY:-}\" ] || exit 9\nwhile [ $# -gt 0 ]; do if [ \"$1\" = --model ]; then model=$2; break; fi; shift; done\nprintf '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\"}]}}\\n{\"type\":\"result\",\"is_error\":false,\"result\":\"boxp-model-canary\",\"modelUsage\":{\"%s\":{}}}\\n' \"$model\"\n")
(fs/set-posix-file-permissions fake "rwxr-xr-x")
(def board (str root "/board"))
(spit board "#!/bin/sh\nprintf \"%s\\n\" \"$1\" >> \"$BOARD_CALL_LOG\"\necho BOXP-123\n")
(fs/set-posix-file-permissions board "rwxr-xr-x")
(def state (str root "/state.edn"))
(def board-log (str root "/board-calls"))
(spit state (pr-str {:verified {"claude-fable" "claude-fable-5-2" "claude-opus" "claude-opus-5-5" "claude-sonnet" "claude-sonnet-5-5"}}))
(def official (str root "/official.md"))
(def ids (str root "/ids"))
(spit official "| Claude API ID | `claude-fable-5-3` | `claude-fable-5-4-preview` |\n")
(spit ids "claude-fable-5-3\n")
;; Same shape as the official page: covered models share one requirement line.
(def retention (str root "/retention.md"))
(spit retention "* **Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, Claude Fable 5.3, Claude Fable 5.4, Claude Fable 5.9 and Claude Fable 5.10:** These models require 30-day data retention and are not available under ZDR.\n")
(defn call [& args] (let [r @(p/process (into ["bb" (str "-Duser.home=" root) script] args) {:extra-env {"HOME" root "CODEX_TASK_BOARD_MODEL_STATE" state "MODEL_UPDATES_CLAUDE_BIN" fake "MODEL_UPDATES_TASK_BOARD_CMD" board "BOARD_CALL_LOG" board-log "ANTHROPIC_API_KEY" "fixture-must-not-reach-canary"} :out :string :err :string})] (when-not (zero? (:exit r)) (throw (ex-info (:err r) r))) (json/parse-string (:out r) true)))
(def base ["--catalog" catalog])
(def tick-args ["tick" "--catalog" catalog "--official-file" official "--cli-ids-file" ids "--retention-file" retention])
(let [r (apply call tick-args)] (assert (= "proposed" (get-in r [:roles :claude-fable :status]))))
(assert (= "skipped" (:status (apply call tick-args))))
(assert (map? (:state (call "status" "--catalog" catalog))))
(assert (= "held" (:status (apply call (concat ["hold" "--role" "claude-fable" "--model" "claude-fable-5-1"] base)))))
(assert (= "released" (:status (apply call (concat ["release" "--role" "claude-fable"] base)))))
(assert (= "pinned" (:status (apply call (concat ["pin" "--role" "claude-fable" "--model" "claude-fable-5-3" "--ticket" "BOXP-123"] base)))))
(println "PASS: candidate, canary, proposal, daily skip, hold, release and pin")
;; Every tick uses fixture files and the fake executable; reset verification to
;; avoid invoking a deployed-model canary when testing discovery alone.
(defn reset-state [] (spit state (pr-str {:verified {"claude-fable" "claude-fable-5-3" "claude-opus" "claude-opus-5-5" "claude-sonnet" "claude-sonnet-5-5"}})))
(defn status-for [contents cli-contents]
  (reset-state) (spit official contents) (spit ids cli-contents)
  (get-in (apply call tick-args) [:roles :claude-fable :status]))
(assert (= "current" (status-for "| Claude API ID | `claude-fable-5-2` | `claude-sonnet-9-9` | `claude-fable-5-4-preview` | `claude-fable-5-4-20261110` |\n" "")))
(assert (= "current" (status-for "| Claude API ID | `claude-fable-5-3` |\n" "")))
(assert (= "waiting-cli" (status-for "| Claude API ID | `claude-fable-5-4` |\n" "")))
(assert (= "waiting-cli" (status-for "| Claude API ID | `claude-fable-5-4` |\n" "claude-fable-5-4-preview claude-fable-5-4.20261110")))
(reset-state) (fs/delete official)
(assert (= "catalog-error" (get-in (apply call tick-args) [:roles :claude-fable :status])))
;; 5.5 is absent from the covered list (5.1 must not match 5.10 either), so its retention differs from the pin.
(assert (= "policy-diff" (status-for "| Claude API ID | `claude-fable-5-5` |\n" "claude-fable-5-5")))
(let [r (str root "/retention-missing.md")] (spit r "no requirement here\n") (reset-state) (spit official "| Claude API ID | `claude-fable-5-4` |\n") (spit ids "claude-fable-5-4")
  (assert (= "policy-diff" (get-in (apply call (concat (butlast tick-args) [r])) [:roles :claude-fable :status]))))
;; A catalog row whose IDs cannot be parsed for the family is an error, not "current".
(assert (= "catalog-error" (status-for "| Claude API ID | `claude-fable-latest` | `fable 5.4` |\n" "")))
;; Retention lists that cannot be parsed or disagree (format change, partial body) never pass as "same".
(doseq [body ["* **Covered models:** These models require 30-day data retention.\n"
              "* **Claude Fable 5.3:** These models require 30-day data retention.\nClaude Fable 5.3 and Claude Fable 5.4 are designated Covered Models and require 30-day data retention.\n"]]
  (let [r (str root "/retention-broken.md")] (spit r body) (reset-state) (spit official "| Claude API ID | `claude-fable-5-4` |\n") (spit ids "claude-fable-5-4")
    (assert (= "policy-diff" (get-in (apply call (concat (butlast tick-args) [r])) [:roles :claude-fable :status])))))
(println "PASS: old, equal, foreign and suffixed IDs, CLI wait, catalog error and policy difference")
;; FileChannel locks interoperate with POSIX record locks held by another process.
(let [lock-dir (str root "/.codex-task-board/model-updates")
      lock-file (str lock-dir "/tick.lock") marker (str root "/lock-ready")
      _ (fs/create-dirs lock-dir)
      proc (p/process ["python3" "-c" "import fcntl,sys,time; f=open(sys.argv[1],'w'); fcntl.lockf(f,fcntl.LOCK_EX); open(sys.argv[2],'w').close(); time.sleep(20)" lock-file marker])]
  (try
    (loop [n 0] (when (and (< n 100) (not (fs/exists? marker))) (Thread/sleep 50) (recur (inc n))))
    (assert (fs/exists? marker))
    (assert (= "locked" (:status (apply call tick-args))))
    (finally (.destroy (:proc proc)))))
;; Numeric ordering and idempotent proposals.
(reset-state)
(spit official "| Claude API ID | `claude-fable-5-9` | `claude-fable-5-10` |\n")
(spit ids "claude-fable-5-9\nclaude-fable-5-10\n")
(let [r (apply call tick-args)] (assert (= "claude-fable-5-10" (get-in r [:roles :claude-fable :candidate]))))
(let [before (:proposals (edn/read-string (slurp state))) calls (slurp board-log) r (apply call (concat tick-args ["--force"]))]
  (assert (= "proposed" (get-in r [:roles :claude-fable :status])))
  (assert (= before (:proposals (edn/read-string (slurp state)))))
  (assert (= calls (slurp board-log))))
;; The newly deployed pin is verified independently from discovery.
(reset-state)
(let [v (edn/read-string (slurp state))] (spit state (pr-str (assoc-in v [:verified "claude-fable"] "claude-fable-5-2"))))
(spit official "| Claude API ID | `claude-fable-5-3` |\n")
(apply call tick-args)
(let [v (edn/read-string (slurp state))]
  (assert (= "claude-fable-5-3" (get-in v [:verified "claude-fable"])))
  (assert (some #(= "claude-fable-5-3" (:model %)) (:history v))))
(spit official "| Claude API ID | `claude-fable-5-9` | `claude-fable-5-10` |\n")
;; Reject both CLI warnings and a modelUsage mismatch for candidates.
(doseq [body ["echo unrecognized_model >&2; echo '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\"}]}}'; echo '{\"type\":\"result\",\"is_error\":false,\"result\":\"boxp-model-canary\",\"modelUsage\":{\"claude-fable-5-10\":{}}}'"
              "echo '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\"}]}}'; echo '{\"type\":\"result\",\"is_error\":false,\"result\":\"boxp-model-canary\",\"modelUsage\":{\"claude-opus-5-5\":{}}}'"]]
  (spit fake (str "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 2.1.321; exit 0; fi\n" body "\n"))
  (reset-state)
  (let [r (apply call tick-args)]
    (assert (= "canary-failed" (get-in r [:roles :claude-fable :status])))
    (assert (empty? (:proposals (edn/read-string (slurp state)))))))
;; A failing deployed-model canary must hold the previous pin.
(spit fake "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 2.1.321; exit 0; fi\necho unrecognized_model >&2\necho '{\"type\":\"result\",\"is_error\":true}'\n")
(reset-state)
(let [v (edn/read-string (slurp state))] (spit state (pr-str (assoc-in v [:verified "claude-fable"] "claude-fable-5-2"))))
(let [r (apply call tick-args)]
  (assert (= "verification-failed" (get-in r [:roles :claude-fable :status])))
  (assert (= "claude-fable-5-2" (get-in (edn/read-string (slurp state)) [:hold "claude-fable"]))))
;; A later passing canary releases only the automatic hold; a manual hold stays.
(def passing (str "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 2.1.321; exit 0; fi\nwhile [ $# -gt 0 ]; do if [ \"$1\" = --model ]; then model=$2; break; fi; shift; done\nprintf '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\"}]}}\\n{\"type\":\"result\",\"is_error\":false,\"result\":\"boxp-model-canary\",\"modelUsage\":{\"%s\":{}}}\\n' \"$model\"\n"))
(spit fake passing)
(apply call (concat tick-args ["--force"]))
(let [v (edn/read-string (slurp state))]
  (assert (nil? (get-in v [:hold "claude-fable"])))
  (assert (= "claude-fable-5-3" (get-in v [:verified "claude-fable"]))))
(apply call (concat ["hold" "--role" "claude-opus" "--model" "claude-opus-5-5"] base))
(let [v (edn/read-string (slurp state))] (spit state (pr-str (update v :verified dissoc "claude-opus"))))
(apply call (concat tick-args ["--force"]))
(assert (= "claude-opus-5-5" (get-in (edn/read-string (slurp state)) [:hold "claude-opus"])))
;; A CLI without the candidate still files one update ticket (to bump the CLI), never twice.
(spit official "| Claude API ID | `claude-fable-5-4` |\n") (spit ids "")
(let [r (apply call (concat tick-args ["--force"])) calls (slurp board-log)]
  (assert (= "waiting-cli" (get-in r [:roles :claude-fable :status])))
  (assert (= "BOXP-123" (get-in (edn/read-string (slurp state)) [:proposals ["claude-fable" "claude-fable-5-4"]])))
  (apply call (concat tick-args ["--force"]))
  (assert (= calls (slurp board-log))))
;; Once the CLI knows a waiting-cli candidate, the existing ticket does not skip the canary.
(spit ids "claude-fable-5-4")
(spit fake "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 2.1.321; exit 0; fi\necho '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\"}]}}'; echo '{\"type\":\"result\",\"is_error\":false,\"result\":\"boxp-model-canary\",\"modelUsage\":{\"claude-opus-5-5\":{}}}'\n")
(assert (= "canary-failed" (get-in (apply call (concat tick-args ["--force"])) [:roles :claude-fable :status])))
(spit fake passing)
(let [calls (slurp board-log)]
  (assert (= "proposed" (get-in (apply call (concat tick-args ["--force"])) [:roles :claude-fable :status])))
  (assert (get-in (edn/read-string (slurp state)) [:candidate-verified ["claude-fable" "claude-fable-5-4"]]))
  (assert (= calls (slurp board-log))))
;; A failing deployed-model canary keeps an existing manual hold and never turns it automatic.
(apply call (concat ["hold" "--role" "claude-fable" "--model" "claude-fable-5-3"] base))
(let [v (edn/read-string (slurp state))] (spit state (pr-str (update v :verified dissoc "claude-fable"))))
(spit fake "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 2.1.321; exit 0; fi\necho '{\"type\":\"result\",\"is_error\":true}'\n")
(assert (= "verification-failed" (get-in (apply call (concat tick-args ["--force"])) [:roles :claude-fable :status])))
(let [v (edn/read-string (slurp state))]
  (assert (= "claude-fable-5-3" (get-in v [:hold "claude-fable"])))
  (assert (not (get-in v [:auto-hold "claude-fable"]))))
(spit fake passing)
(apply call (concat tick-args ["--force"]))
(assert (= "claude-fable-5-3" (get-in (edn/read-string (slurp state)) [:hold "claude-fable"])))
(apply call (concat ["release" "--role" "claude-fable"] base))
;; The real retention page lists Fable 5.1 and 5.2 alike.
(let [real "Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, and Claude Mythos 5 are designated Covered Models (see the support article) and require 30-day data retention; ZDR is therefore not available."]
  (spit retention real) (reset-state)
  (let [v (edn/read-string (slurp state))] (spit state (pr-str (assoc v :verified {"claude-fable" "claude-fable-5-2" "claude-opus" "claude-opus-5-5" "claude-sonnet" "claude-sonnet-5-5"}))))
  (spit catalog (str/replace (slurp catalog) "claude-fable-5-3" "claude-fable-5-1"))
  (spit official "| Claude API ID | `claude-fable-5-2` |\n") (spit ids "claude-fable-5-2")
  (let [c (edn/read-string (slurp catalog))] (spit catalog (pr-str (assoc-in c [:roles "claude-fable" :model] "claude-fable-5-1")))
    (spit state (pr-str {:verified {"claude-fable" "claude-fable-5-1" "claude-opus" "claude-opus-5-5" "claude-sonnet" "claude-sonnet-5-5"}})))
  (assert (= "proposed" (get-in (apply call (concat tick-args ["--force"])) [:roles :claude-fable :status]))))
(println "PASS: numeric ordering, duplicate proposal, failed deployment hold, auto-hold release, manual hold kept, CLI wait ticket, canary after CLI support and real retention text")
;; pin refuses a candidate without a canary pass (recorded by tick or run now).
(let [c (edn/read-string (slurp catalog)) st (edn/read-string (slurp state))]
  (spit fake "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 2.1.321; exit 0; fi\necho '{\"type\":\"result\",\"is_error\":true}'\n")
  (assert (try (apply call (concat ["pin" "--role" "claude-fable" "--model" "claude-fable-5-7" "--ticket" "BOXP-123"] base)) false (catch Exception _ true)))
  (assert (= c (edn/read-string (slurp catalog))))
  (spit fake passing)
  (assert (= "pinned" (:status (apply call (concat ["pin" "--role" "claude-fable" "--model" "claude-fable-5-7" "--ticket" "BOXP-123"] base)))))
  (assert (get-in (edn/read-string (slurp state)) [:candidate-verified ["claude-fable" "claude-fable-5-7"]]))
  (spit catalog (pr-str c)) (spit state (pr-str st)))
;; hold waits for a running tick's lock instead of racing its state write.
(let [lock-file (str root "/.codex-task-board/model-updates/tick.lock") marker (str root "/lock-ready-2")
      proc (p/process ["python3" "-c" "import fcntl,sys,time; f=open(sys.argv[1],'w'); fcntl.lockf(f,fcntl.LOCK_EX); open(sys.argv[2],'w').close(); time.sleep(2)" lock-file marker])]
  (loop [n 0] (when (and (< n 100) (not (fs/exists? marker))) (Thread/sleep 50) (recur (inc n))))
  (let [started (System/currentTimeMillis)
        r (apply call (concat ["hold" "--role" "claude-opus" "--model" "claude-opus-5-5"] base))]
    (assert (= "held" (:status r)))
    (assert (>= (- (System/currentTimeMillis) started) 1000))
    (assert (= "claude-opus-5-5" (get-in (edn/read-string (slurp state)) [:hold "claude-opus"]))))
  @proc
  (apply call (concat ["release" "--role" "claude-opus"] base)))
(println "PASS: pin requires candidate canary, hold waits for tick lock")
(fs/delete-tree root)
