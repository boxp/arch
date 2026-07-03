(ns codex-cron-lib
  (:require [babashka.fs :as fs]
            [clojure.edn :as edn]
            [clojure.string :as str]))

(def default-root "/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron")
(def default-registry "jobs.edn")
(def default-state "jobs-state.edn")

(defn fail [message]
  (binding [*out* *err*]
    (println (str "error: " message)))
  (System/exit 1))

(defn root []
  (or (System/getProperty "codex.cron.root")
      (System/getenv "CODEX_CRON_ROOT")
      default-root))

(defn registry-path []
  (fs/path (root) (or (System/getenv "CODEX_CRON_JOBS_FILE") default-registry)))

(defn state-path []
  (fs/path (root) default-state))

(defn prompts-dir []
  (fs/path (root) "prompts"))

(defn runs-dir []
  (fs/path (root) "runs"))

(defn locks-dir []
  (fs/path (root) "locks"))

(defn ensure-root! []
  (doseq [path [(root) (prompts-dir) (runs-dir) (locks-dir)]]
    (fs/create-dirs path))
  (when-not (fs/exists? (registry-path))
    (spit (str (registry-path)) "{:version 1\n :jobs []}\n")))

(defn read-edn-file [path fallback]
  (if (fs/exists? path)
    (edn/read-string (slurp (str path)))
    fallback))

(defn write-edn-file! [path value]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str (pr-str value) "\n")))

(defn registry []
  (ensure-root!)
  (let [value (read-edn-file (registry-path) {:version 1 :jobs []})]
    (cond
      (vector? value) {:version 1 :jobs value}
      (map? value) (update value :jobs #(vec (or % [])))
      :else (fail (str "invalid registry: " (registry-path))))))

(defn save-registry! [value]
  (write-edn-file! (registry-path) (update value :jobs vec)))

(defn jobs []
  (:jobs (registry)))

(defn job [job-id]
  (or (first (filter #(= job-id (:id %)) (jobs)))
      (fail (str "job not found: " job-id))))

(defn prompt-path [job-or-id]
  (let [job (if (map? job-or-id) job-or-id (job job-or-id))
        value (:prompt-file job)]
    (cond
      (nil? value) (fs/path (prompts-dir) (str (:id job) ".md"))
      (str/starts-with? value "/") (fs/path value)
      :else (fs/path (root) value))))

(defn shell-quote [value]
  (let [s (str value)]
    (str "'" (str/replace s #"'" "'\"'\"'") "'")))

(defn emit [name value]
  (when-not (or (nil? value) (= "" value))
    (println (str name "=" (shell-quote value)))))
