#!/usr/bin/env bb

(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[clojure.string :as str])

(let [local-lib (fs/path (fs/parent *file*) "../../.." "cron" "codex_cron_lib.bb")
      image-lib "/opt/codex-workspace/cron/codex_cron_lib.bb"]
  (load-file (or (System/getenv "CODEX_CRON_LIB")
                 (when (fs/exists? local-lib) (str (fs/normalize local-lib)))
                 image-lib)))
(require '[codex-cron-lib :as lib])

(def key-order
  [:id :name :enabled :schedule :time-zone :prompt-file :workdir :output-root
   :model :profile :bypass-approvals :extra-args])

(defn usage []
  (println "usage: codex_cron_jobs.bb [--root PATH] <list|show|add|update|enable|disable|delete|run> ...")
  (System/exit 2))

(defn parse-global [args]
  (loop [args args]
    (cond
      (= "--root" (first args))
      (do
        (System/setProperty "codex.cron.root" (second args))
        (recur (drop 2 args)))

      :else (vec args))))

(defn root []
  (or (System/getProperty "codex.cron.root") (lib/root)))

(defn opts-map [args]
  (loop [args args opts {} positional []]
    (cond
      (empty? args) {:opts opts :positional positional}
      (str/starts-with? (first args) "--")
      (if (second args)
        (recur (drop 2 args) (assoc opts (subs (first args) 2) (second args)) positional)
        (lib/fail (str "missing value for " (first args))))
      :else
      (recur (rest args) opts (conj positional (first args))))))

(defn require-opt [opts k]
  (or (get opts k) (lib/fail (str "--" k " is required"))))

(defn bool-opt [opts k default]
  (case (str/lower-case (get opts k (str default)))
    "true" true
    "false" false
    (lib/fail (str "--" k " must be true or false"))))

(defn registry []
  (lib/registry))

(defn save-registry! [value]
  (lib/save-registry! value))

(defn prompts-dir []
  (fs/path (root) "prompts"))

(defn prompt-path [job]
  (lib/prompt-path job))

(defn find-job [jobs job-id]
  (or (first (filter #(= job-id (:id %)) jobs))
      (lib/fail (str "job not found: " job-id))))

(defn assoc-some [m k v]
  (if (or (nil? v) (= "" v)) m (assoc m k v)))

(defn ordered-job [job]
  (let [known (set key-order)]
    (merge
     (select-keys job key-order)
     (into (sorted-map) (remove (comp known key) job)))))

(defn cmd-list []
  (doseq [job (:jobs (registry))]
    (println (str/join "\t" [(:id job)
                             (if (true? (:enabled job)) "enabled" "disabled")
                             (or (:schedule job) "")
                             (str (prompt-path job))]))))

(defn cmd-show [job-id]
  (let [job (find-job (:jobs (registry)) job-id)]
    (doseq [[k v] (ordered-job job)]
      (println (str (name k) ": " v)))))

(defn write-prompt! [job opts]
  (let [target (prompt-path job)]
    (fs/create-dirs (fs/parent target))
    (cond
      (contains? opts "prompt") (spit (str target) (str (get opts "prompt") "\n"))
      (contains? opts "prompt-source") (spit (str target) (slurp (get opts "prompt-source")))
      :else nil)))

(defn new-job [opts]
  (let [id (require-opt opts "id")
        prompt-rel (or (get opts "prompt-file") (str "prompts/" id ".md"))]
    (-> {:id id
         :name (or (get opts "name") id)
         :enabled (bool-opt opts "enabled" false)
         :schedule (require-opt opts "schedule")
         :time-zone (get opts "time-zone" "Etc/UTC")
         :prompt-file prompt-rel
         :workdir (get opts "workdir" "/home/boxp")
         :output-root (get opts "output-root" (str (root) "/runs"))
         :bypass-approvals (bool-opt opts "bypass-approvals" true)}
        (assoc-some :model (get opts "model"))
        (assoc-some :profile (get opts "profile"))
        (assoc-some :extra-args (get opts "extra-args")))))

(defn cmd-add [opts]
  (let [state (registry)
        job (new-job opts)]
    (when (some #(= (:id job) (:id %)) (:jobs state))
      (lib/fail (str "job already exists: " (:id job))))
    (when-not (or (contains? opts "prompt") (contains? opts "prompt-source"))
      (lib/fail "--prompt or --prompt-source is required"))
    (write-prompt! job opts)
    (save-registry! (update state :jobs conj job))))

(defn patch-job [job opts]
  (cond-> job
    (contains? opts "name") (assoc :name (get opts "name"))
    (contains? opts "schedule") (assoc :schedule (get opts "schedule"))
    (contains? opts "time-zone") (assoc :time-zone (get opts "time-zone"))
    (contains? opts "prompt-file") (assoc :prompt-file (get opts "prompt-file"))
    (contains? opts "workdir") (assoc :workdir (get opts "workdir"))
    (contains? opts "output-root") (assoc :output-root (get opts "output-root"))
    (contains? opts "model") (assoc-some :model (get opts "model"))
    (contains? opts "profile") (assoc-some :profile (get opts "profile"))
    (contains? opts "extra-args") (assoc-some :extra-args (get opts "extra-args"))
    (contains? opts "bypass-approvals") (assoc :bypass-approvals (bool-opt opts "bypass-approvals" true))))

(defn cmd-update [job-id opts]
  (let [state (registry)
        jobs (mapv #(if (= job-id (:id %)) (patch-job % opts) %) (:jobs state))
        job (find-job jobs job-id)]
    (when (or (contains? opts "prompt") (contains? opts "prompt-source"))
      (write-prompt! job opts))
    (save-registry! (assoc state :jobs jobs))))

(defn cmd-set-enabled [job-id enabled?]
  (let [state (registry)
        jobs (mapv #(if (= job-id (:id %)) (assoc % :enabled enabled?) %) (:jobs state))]
    (find-job jobs job-id)
    (save-registry! (assoc state :jobs jobs))))

(defn cmd-delete [job-id]
  (let [state (registry)
        job (find-job (:jobs state) job-id)
        prompt (str (fs/normalize (prompt-path job)))
        prompt-root (str (fs/normalize (prompts-dir)))]
    (when (and (not= "false" (System/getenv "CODEX_CRON_DELETE_PROMPT"))
               (str/starts-with? prompt prompt-root))
      (fs/delete-if-exists prompt))
    (save-registry! (assoc state :jobs (vec (remove #(= job-id (:id %)) (:jobs state)))))))

(defn cmd-run [job-id]
  (find-job (:jobs (registry)) job-id)
  @(p/process ["/opt/codex-workspace/cron/run-codex-cron.sh" job-id]
              {:out :inherit :err :inherit}))

(defn -main [& argv]
  (let [args (parse-global argv)
        command (first args)
        rest-args (vec (rest args))]
    (case command
      "list" (cmd-list)
      "show" (cmd-show (or (first rest-args) (lib/fail "job id is required")))
      "add" (cmd-add (:opts (opts-map rest-args)))
      "update" (let [{:keys [opts positional]} (opts-map rest-args)]
                 (cmd-update (or (first positional) (lib/fail "job id is required")) opts))
      "enable" (cmd-set-enabled (or (first rest-args) (lib/fail "job id is required")) true)
      "disable" (cmd-set-enabled (or (first rest-args) (lib/fail "job id is required")) false)
      "delete" (cmd-delete (or (first rest-args) (lib/fail "job id is required")))
      "run" (cmd-run (or (first rest-args) (lib/fail "job id is required")))
      (usage))))

(apply -main *command-line-args*)
