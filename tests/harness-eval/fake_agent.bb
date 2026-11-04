#!/usr/bin/env bb
;; harness-eval 用の偽エージェント。実モデルを呼ばずに headless エージェントの振る舞いを再現する。
;; 呼び出し: cwd = 試行ディレクトリ、stdin = prompt。stdout に Claude stream-json 風の行を出す。
;; prompt 本文は決して stdout に出さない。
;;
;; env:
;;   HARNESS_EVAL_FAKE_MODE        solve (既定) | noop | break | sleep | garbage | error
;;   HARNESS_EVAL_FAKE_ARM_B_MODE  arm B のときだけ上書きする mode (劣化あり/なしの再現用)
;;   HARNESS_EVAL_FAKE_SLEEP_SECONDS  sleep mode の秒数 (既定 5)
(require '[babashka.fs :as fs] '[clojure.string :as str])

(def here (fs/parent (fs/canonicalize *file*)))
(def tasks-dir (fs/path here "tasks"))

(defn emit! [line] (println line) (flush))
(def init-line "{\"type\":\"system\",\"subtype\":\"init\",\"model\":\"fake-model-1\"}")
(defn tool-line [name]
  (str "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"" name "\",\"input\":{}}]}}"))
(def result-line "{\"type\":\"result\",\"subtype\":\"success\"}")

(def prompt (slurp *in*))
(defn line-value [prefix]
  (some (fn [l] (when (str/starts-with? l prefix) (str/trim (subs l (count prefix))))) (str/split-lines prompt)))
(def task (line-value "harness-eval task:"))
(def arm (line-value "harness-eval arm:"))

(when-not (and task (re-matches #"T\d\d" task))
  (emit! init-line)
  (System/exit 1))

(def mode (let [base (or (System/getenv "HARNESS_EVAL_FAKE_MODE") "solve")
                b (System/getenv "HARNESS_EVAL_FAKE_ARM_B_MODE")]
            (if (and (= "B" arm) (seq b)) b base)))

(def solution-dir (fs/path tasks-dir task "solution"))
(def base-dir (fs/path tasks-dir task "base"))

(defn solution-files []
  (->> (fs/glob solution-dir "**") (filter fs/regular-file?) (map #(str (fs/relativize solution-dir %))) sort vec))

(defn solve! []
  (doseq [rel (solution-files)]
    (when-let [parent (fs/parent (fs/path rel))] (fs/create-dirs parent))
    (fs/copy (fs/path solution-dir rel) (fs/path rel) {:replace-existing true})))

(defn emit-tool-events! [edited]
  (emit! (tool-line "Read")) (emit! (tool-line "Read")) (emit! (tool-line "Grep"))
  (dotimes [_ edited] (emit! (tool-line "Edit")))
  (emit! (tool-line "Bash")))

(emit! init-line)
(case mode
  "solve" (do (solve!) (emit-tool-events! (count (solution-files))) (emit! result-line))
  "noop" (do (emit! (tool-line "Read")) (emit! result-line))
  "break" (let [sol (set (solution-files))
                extra (->> (fs/glob base-dir "**") (filter fs/regular-file?)
                           (map #(str (fs/relativize base-dir %))) sort (remove sol) first)]
            (solve!)
            (spit "unrelated-extra.txt" "extra\n")
            (when extra (spit extra "# touched by break mode\n" :append true))
            (emit-tool-events! (+ 2 (count sol)))
            (emit! result-line))
  "sleep" (do (Thread/sleep (* 1000 (Long/parseLong (or (System/getenv "HARNESS_EVAL_FAKE_SLEEP_SECONDS") "5"))))
              (emit! result-line))
  "garbage" (do (emit! "not json {{{") (emit! "still not json") (emit! "}}}")
                (solve!) (emit-tool-events! (count (solution-files))) (emit! result-line))
  "error" (System/exit 3)
  (do (binding [*out* *err*] (println "unknown HARNESS_EVAL_FAKE_MODE:" mode)) (System/exit 2)))
