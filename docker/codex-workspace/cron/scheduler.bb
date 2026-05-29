#!/usr/bin/env bb

(require '[babashka.process :as p]
         '[babashka.fs :as fs]
         '[clojure.set :as set]
         '[clojure.string :as str])

(load-file (str (fs/parent *file*) "/codex_cron_lib.bb"))
(require '[codex-cron-lib :as lib])

(defn parse-long* [s]
  (try
    (Long/parseLong (str s))
    (catch Exception _
      (lib/fail (str "invalid cron number: " s)))))

(defn expand-part [part min-v max-v]
  (let [[base step-raw] (str/split part #"/" 2)
        step (if step-raw (parse-long* step-raw) 1)
        range-values (fn [start end] (range start (inc end)))]
    (when (not (pos? step))
      (lib/fail (str "invalid cron step: " part)))
    (let [[step-start values] (cond
                                (= "*" base) [min-v (range-values min-v max-v)]
                                (str/includes? base "-") (let [[a b] (map parse-long* (str/split base #"-" 2))]
                                                           [a (range-values a b)])
                                :else (let [v (parse-long* base)]
                                        [v [v]]))]
      (->> values
         (filter #(<= min-v % max-v))
         (filter #(zero? (mod (- % step-start) step)))
         set))))

(defn parse-field [field min-v max-v]
  (if (= "*" field)
    :any
    (apply set/union (map #(expand-part % min-v max-v) (str/split field #",")))))

(defn cron-spec [schedule]
  (let [fields (str/split (str/trim schedule) #"\s+")]
    (when-not (= 5 (count fields))
      (lib/fail (str "only 5-field cron is supported: " schedule)))
    (zipmap [:minute :hour :day-of-month :month :day-of-week]
            [(parse-field (nth fields 0) 0 59)
             (parse-field (nth fields 1) 0 23)
             (parse-field (nth fields 2) 1 31)
             (parse-field (nth fields 3) 1 12)
             (parse-field (nth fields 4) 0 7)])))

(defn contains-any? [values value]
  (or (= :any values) (contains? values value)))

(defn due? [job zdt]
  (let [spec (cron-spec (:schedule job))
        dow (mod (.getValue (.getDayOfWeek zdt)) 7)]
    (and (contains-any? (:minute spec) (.getMinute zdt))
         (contains-any? (:hour spec) (.getHour zdt))
         (contains-any? (:day-of-month spec) (.getDayOfMonth zdt))
         (contains-any? (:month spec) (.getMonthValue zdt))
         (or (contains-any? (:day-of-week spec) dow)
             (and (zero? dow) (contains-any? (:day-of-week spec) 7))))))

(defn minute-key [zdt]
  (.toString (.truncatedTo zdt java.time.temporal.ChronoUnit/MINUTES)))

(defn state []
  (lib/read-edn-file (lib/state-path) {:last-fired {}}))

(defn save-state! [value]
  (lib/write-edn-file! (lib/state-path) value))

(defn job-time [job]
  (java.time.ZonedDateTime/now
   (java.time.ZoneId/of (or (:time-zone job) "Etc/UTC"))))

(defn fire! [job]
  (let [id (:id job)]
    (println (str "codex cron firing " id))
    (p/process ["/opt/codex-workspace/cron/run-codex-cron.sh" id]
               {:out :inherit :err :inherit})))

(defn tick! []
  (let [state (state)]
    (loop [jobs (lib/jobs)
           state state]
      (if-not (seq jobs)
        (save-state! state)
        (let [job (first jobs)
              id (:id job)
              now (job-time job)
              key (minute-key now)
              state-key (keyword id)]
          (if (and (true? (:enabled job))
                   (:schedule job)
                   (due? job now)
                   (not= key (get-in state [:last-fired state-key])))
            (do
              (fire! job)
              (recur (rest jobs) (assoc-in state [:last-fired state-key] key)))
            (recur (rest jobs) state)))))))

(defn -main []
  (lib/ensure-root!)
  (println (str "codex cron scheduler started, registry=" (lib/registry-path)))
  (loop []
    (try
      (tick!)
      (catch Exception e
        (binding [*out* *err*]
          (println (str "codex cron scheduler tick failed: " (.getMessage e))))))
    (Thread/sleep (* 1000 (Long/parseLong (or (System/getenv "CODEX_CRON_POLL_SECONDS") "30"))))
    (recur)))

(-main)
