#!/usr/bin/env bb

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def configmap-path "argoproj/codex-workspace/cron-configmap.yaml")
(def cronjob-path "argoproj/codex-workspace/cronjob.yaml")
(def job-key-order
  ["id" "name" "enabled" "schedule" "timeZone" "session" "promptFile"
   "workdir" "outputRoot" "model" "profile" "bypassApprovals" "extraArgs"])

(defn fail [message]
  (binding [*out* *err*]
    (println (str "error: " message)))
  (System/exit 1))

(defn usage []
  (println "usage: codex_cron_jobs.bb [--repo PATH] <list|show|add|update|enable|disable|delete> ...")
  (System/exit 2))

(defn parse-scalar [raw]
  (let [value (str/trim (or raw ""))]
    (cond
      (and (>= (count value) 2)
           (= (first value) (last value))
           (#{\" \'} (first value)))
      (subs value 1 (dec (count value)))

      (= "true" (str/lower-case value)) true
      (= "false" (str/lower-case value)) false
      :else value)))

(defn format-scalar [value]
  (cond
    (true? value) "true"
    (false? value) "false"
    :else
    (let [s (str value)]
      (if (or (empty? s)
              (not= s (str/trim s))
              (re-find #"\s|[:#{}\[\]]" s))
        (str "\"" (str/replace s #"\"" "\\\"") "\"")
        s))))

(defn read-file [path]
  (try
    (slurp (str path))
    (catch java.io.FileNotFoundException _
      (fail (str "missing file: " path)))))

(defn write-file [path text]
  (spit (str path) text))

(defn data-keys [text]
  (map second (re-seq #"(?m)^  ([A-Za-z0-9_.-]+): \|$" text)))

(defn index-of [s needle from]
  (.indexOf ^String s ^String needle (int from)))

(defn block-range [text key next-keys]
  (let [marker (str "  " key ": |\n")
        start (.indexOf ^String text marker)]
    (when (neg? start)
      (fail (str "missing ConfigMap data key: " key)))
    (let [content-start (+ start (count marker))
          candidates (keep #(let [idx (index-of text (str "  " % ": |\n") content-start)]
                               (when-not (neg? idx) idx))
                           next-keys)
          content-end (if (seq candidates) (apply min candidates) (count text))]
      [content-start content-end])))

(defn get-block [text key next-keys]
  (let [[content-start content-end] (block-range text key next-keys)
        block (subs text content-start content-end)
        lines (for [line (str/split-lines block)]
                (cond
                  (str/starts-with? line "    ") (subs line 4)
                  (= line "") ""
                  :else (fail (str "unexpected indentation in " key ": " line))))]
    (str/replace (str/join "\n" lines) #"\n+$" "")))

(defn render-block [value]
  (apply str
         (for [line (str/split-lines (str/replace (or value "") #"\n+$" ""))]
           (if (empty? line) "\n" (str "    " line "\n")))))

(defn set-block [text key value next-keys]
  (let [[content-start content-end] (block-range text key next-keys)]
    (str (subs text 0 content-start)
         (render-block value)
         (subs text content-end))))

(defn parse-jobs [jobs-text]
  (loop [lines (str/split-lines jobs-text)
         jobs []
         current nil]
    (if-not (seq lines)
      (cond-> jobs current (conj current))
      (let [raw (first lines)
            stripped (str/trim raw)]
        (cond
          (or (empty? stripped) (= stripped "jobs:") (str/starts-with? stripped "#"))
          (recur (rest lines) jobs current)

          (str/starts-with? stripped "- ")
          (let [jobs (cond-> jobs current (conj current))
                stripped (str/trim (subs stripped 2))
                current {}]
            (if (empty? stripped)
              (recur (rest lines) jobs current)
              (recur (cons stripped (rest lines)) jobs current)))

          (nil? current)
          (fail (str "property outside job: " raw))

          (not (str/includes? stripped ":"))
          (fail (str "unsupported jobs.yaml line: " raw))

          :else
          (let [[k v] (str/split stripped #":" 2)
                k (str/trim k)]
            (when-not (re-matches #"[A-Za-z][A-Za-z0-9]*" k)
              (fail (str "unsupported key: " k)))
            (recur (rest lines) jobs (assoc current k (parse-scalar v)))))))))

(defn render-jobs [jobs]
  (str/join
   "\n"
   (concat
    ["jobs:"]
    (mapcat
     (fn [job]
       (let [known (set job-key-order)
             extra (sort (remove known (keys job)))]
         (concat
          [(str "  - id: " (format-scalar (get job "id")))]
          (for [k (rest job-key-order)
                :when (contains? job k)
                :let [v (get job k)]
                :when (not (or (nil? v) (= "" v)))]
            (str "    " k ": " (format-scalar v)))
          (for [k extra]
            (str "    " k ": " (format-scalar (get job k)))))))
     jobs))))

(defn load-state [repo]
  (let [cm-path (fs/path repo configmap-path)
        cm-text (read-file cm-path)
        keys (data-keys cm-text)
        jobs-text (get-block cm-text "jobs.yaml" (remove #{"jobs.yaml"} keys))]
    {:cm-path cm-path
     :cronjob-path (fs/path repo cronjob-path)
     :cm-text cm-text
     :jobs (parse-jobs jobs-text)}))

(defn save-jobs! [{:keys [cm-path cm-text jobs]}]
  (let [keys (data-keys cm-text)
        new-text (set-block cm-text "jobs.yaml" (render-jobs jobs) (remove #{"jobs.yaml"} keys))]
    (write-file cm-path new-text)))

(defn find-job [jobs job-id]
  (or (first (filter #(= job-id (get % "id")) jobs))
      (fail (str "job not found: " job-id))))

(defn prompt-key [prompt-file]
  (let [key (fs/file-name prompt-file)]
    (when-not (and (str/starts-with? key "prompt-") (str/ends-with? key ".md"))
      (fail "prompt file must look like prompt-<name>.md"))
    key))

(defn set-prompt [cm-text prompt-file prompt]
  (let [key (prompt-key prompt-file)
        keys (data-keys cm-text)]
    (if (some #{key} keys)
      (set-block cm-text key prompt (remove #{key} keys))
      (str (str/replace cm-text #"\n+$" "")
           "\n  " key ": |\n"
           (render-block prompt)))))

(defn delete-prompt [cm-text prompt-file]
  (let [key (prompt-key prompt-file)
        marker (str "  " key ": |\n")
        start (.indexOf ^String cm-text marker)]
    (if (neg? start)
      cm-text
      (let [keys (data-keys cm-text)
            [_ content-end] (block-range cm-text key (remove #{key} keys))]
        (str (subs cm-text 0 start) (subs cm-text content-end))))))

(defn cron-name [job-id]
  (str "codex-cron-" job-id))

(defn cronjob-doc [job]
  (let [job-id (get job "id")
        enabled? (true? (get job "enabled"))
        schedule (get job "schedule" "0 0 * * *")
        tz (get job "timeZone" "Etc/UTC")]
    (format "apiVersion: batch/v1
kind: CronJob
metadata:
  name: %s
  namespace: codex-workspace
  labels:
    app: codex-workspace-cron
    codex-workspace.boxp.io/cron: %s
spec:
  # Keep this in sync with jobs.yaml entry schedule/timeZone/enabled.
  suspend: %s
  schedule: \"%s\"
  timeZone: %s
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 900
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        metadata:
          labels:
            app: codex-workspace-cron
            codex-workspace.boxp.io/cron: %s
        spec:
          restartPolicy: Never
          automountServiceAccountToken: false
          nodeSelector:
            kubernetes.io/arch: amd64
          affinity:
            podAffinity:
              requiredDuringSchedulingIgnoredDuringExecution:
                - labelSelector:
                    matchLabels:
                      app: codex-workspace
                  topologyKey: kubernetes.io/hostname
          containers:
            - name: codex
              image: ghcr.io/boxp/arch/codex-workspace:latest
              imagePullPolicy: Always
              command:
                - /opt/codex-cron/run-codex-cron.sh
              env:
                - name: HOME
                  value: /home/boxp
                - name: CODEX_HOME
                  value: /home/boxp/.codex
                - name: CODEX_CRON_JOB_ID
                  value: %s
                - name: CODEX_CRON_JOBS_FILE
                  value: /opt/codex-cron/jobs.yaml
                - name: GRAFANA_URL
                  value: http://grafana.monitoring.svc.cluster.local:3000
                - name: GRAFANA_SERVICE_ACCOUNT_TOKEN
                  valueFrom:
                    secretKeyRef:
                      name: codex-workspace-grafana
                      key: service-account-token
              securityContext:
                runAsNonRoot: true
                runAsUser: 1000
                runAsGroup: 1000
                allowPrivilegeEscalation: false
                capabilities:
                  drop: [\"ALL\"]
                readOnlyRootFilesystem: false
              resources:
                requests:
                  cpu: \"250m\"
                  memory: \"512Mi\"
                limits:
                  cpu: \"4\"
                  memory: \"8Gi\"
              volumeMounts:
                - name: home
                  mountPath: /home/boxp
                - name: cron-config
                  mountPath: /opt/codex-cron
                  readOnly: true
          volumes:
            - name: home
              persistentVolumeClaim:
                claimName: codex-workspace-home
            - name: cron-config
              configMap:
                name: codex-workspace-cron
                defaultMode: 0555
"
            (cron-name job-id) job-id (if enabled? "false" "true") schedule tz job-id job-id)))

(defn save-cronjobs! [path jobs]
  (write-file path (str (str/join "\n---\n" (map #(str/replace % #"\n+$" "") (map cronjob-doc jobs))) "\n")))

(defn parse-global [args]
  (loop [args args repo "."]
    (if (= "--repo" (first args))
      (recur (drop 2 args) (second args))
      {:repo (fs/absolutize repo) :args (vec args)})))

(defn opts-map [args]
  (loop [args args opts {} positional []]
    (cond
      (empty? args) {:opts opts :positional positional}
      (str/starts-with? (first args) "--")
      (if (second args)
        (recur (drop 2 args) (assoc opts (subs (first args) 2) (second args)) positional)
        (fail (str "missing value for " (first args))))
      :else
      (recur (rest args) opts (conj positional (first args))))))

(defn require-opt [opts k]
  (or (get opts k) (fail (str "--" k " is required"))))

(defn cmd-list [repo]
  (doseq [job (:jobs (load-state repo))]
    (println (str/join "\t" [(get job "id")
                             (if (true? (get job "enabled")) "enabled" "disabled")
                             (get job "schedule" "")
                             (get job "promptFile" "")]))))

(defn cmd-show [repo job-id]
  (doseq [[k v] (find-job (:jobs (load-state repo)) job-id)]
    (println (str k ": " v))))

(defn new-job [opts]
  (let [id (require-opt opts "id")
        prompt-file (or (get opts "prompt-file") (str "prompt-" id ".md"))]
    {"id" id
     "name" (or (get opts "name") id)
     "enabled" (= "true" (get opts "enabled" "false"))
     "schedule" (require-opt opts "schedule")
     "timeZone" (get opts "time-zone" "Etc/UTC")
     "session" "isolated"
     "promptFile" (str "/opt/codex-cron/" (prompt-key prompt-file))
     "workdir" (get opts "workdir" "/home/boxp")
     "outputRoot" (get opts "output-root" "/home/boxp/.codex-cron/runs")
     "bypassApprovals" (= "true" (get opts "bypass-approvals" "true"))}))

(defn save-state! [state]
  (save-jobs! state)
  (save-cronjobs! (:cronjob-path state) (:jobs state)))

(defn cmd-add [repo opts]
  (let [state (load-state repo)
        job (new-job opts)
        prompt (require-opt opts "prompt")]
    (when (some #(= (get job "id") (get % "id")) (:jobs state))
      (fail (str "job already exists: " (get job "id"))))
    (save-state! (-> state
                     (update :cm-text set-prompt (get job "promptFile") prompt)
                     (update :jobs conj job)))))

(defn cmd-update [repo job-id opts]
  (let [state (load-state repo)
        prompt (get opts "prompt")
        jobs (mapv (fn [job]
                     (if (= job-id (get job "id"))
                       (cond-> job
                         (contains? opts "name") (assoc "name" (get opts "name"))
                         (contains? opts "schedule") (assoc "schedule" (get opts "schedule"))
                         (contains? opts "time-zone") (assoc "timeZone" (get opts "time-zone"))
                         (contains? opts "workdir") (assoc "workdir" (get opts "workdir"))
                         (contains? opts "model") (as-> j (if (empty? (get opts "model"))
                                                             (dissoc j "model")
                                                             (assoc j "model" (get opts "model")))))
                       job))
                   (:jobs state))
        job (find-job jobs job-id)]
    (save-state! (cond-> (assoc state :jobs jobs)
                   prompt (update :cm-text set-prompt (get job "promptFile") prompt)))))

(defn cmd-set-enabled [repo job-id enabled?]
  (let [state (load-state repo)
        jobs (mapv #(if (= job-id (get % "id")) (assoc % "enabled" enabled?) %) (:jobs state))]
    (find-job jobs job-id)
    (save-state! (assoc state :jobs jobs))))

(defn cmd-delete [repo job-id]
  (let [state (load-state repo)
        job (find-job (:jobs state) job-id)
        jobs (vec (remove #(= job-id (get % "id")) (:jobs state)))]
    (save-state! (-> state
                     (assoc :jobs jobs)
                     (update :cm-text delete-prompt (get job "promptFile"))))))

(defn -main [& argv]
  (let [{:keys [repo args]} (parse-global argv)
        command (first args)
        rest-args (vec (rest args))]
    (case command
      "list" (cmd-list repo)
      "show" (cmd-show repo (or (first rest-args) (fail "job id is required")))
      "add" (cmd-add repo (:opts (opts-map rest-args)))
      "update" (let [{:keys [opts positional]} (opts-map rest-args)]
                 (cmd-update repo (or (first positional) (fail "job id is required")) opts))
      "enable" (cmd-set-enabled repo (or (first rest-args) (fail "job id is required")) true)
      "disable" (cmd-set-enabled repo (or (first rest-args) (fail "job id is required")) false)
      "delete" (cmd-delete repo (or (first rest-args) (fail "job id is required")))
      (usage))))

(apply -main *command-line-args*)
