#!/usr/bin/env bb
(require '[cheshire.core :as json] '[babashka.process :as process] '[clojure.string :as str] '[clojure.java.io :as io])
(import '[java.time LocalDate Instant ZoneOffset] '[java.nio.file Files] '[java.nio.file.attribute FileAttribute])
(def schema "aws-cost/v1-draft")
(defn date [s] (LocalDate/parse s))
(defn round4 [n] (/ (double (Math/round (* 10000.0 (double n)))) 10000.0))
(defn sanitize [s] (let [x (str/replace (or s "") #"[^A-Za-z]" "")] (if (empty? x) "UnknownError" (subs x 0 (min 80 (count x))))))
(defn fits? [x] (<= (count (.getBytes (json/generate-string x) "UTF-8")) 4000))
(defn guard [status now] (let [attempts (filter #(and (number? %) (<= (- now 86400) % now)) (:attempts status)) success (:last_success_at status)]
  {:skip (or (and (number? success) (<= 0 (- now success) 72000)) (>= (count attempts) 3)) :attempts (vec attempts)}))
(defn aggregate [rows] (let [sums (reduce (fn [m [service amount]] (update m service (fnil + 0.0) amount)) {} rows)
                              top (->> sums (sort-by (fn [[k v]] [(- v) k])) (take 10) (map first) set)]
                          (reduce (fn [m [k v]] (update m (if (top k) k "Other") (fnil + 0.0) v)) {} sums)))
(defn page-decision [pages token] (when (and token (>= pages 5)) (throw (ex-info "PageLimitExceeded" {:code "PageLimitExceeded"}))))
(defn transform [today epoch suffix pages forecast requests]
  (let [first-day (.withDayOfMonth today 1) prev (.minusMonths first-day 1) prev-end (.plusDays prev (min (.lengthOfMonth prev) (dec (.getDayOfMonth today))))
        days (mapcat :ResultsByTime pages)
        rows (for [d days g (:Groups d)] {:day (date (get-in d [:TimePeriod :Start])) :service (first (:Keys g)) :account (second (:Keys g)) :amount (Double/parseDouble (get-in g [:Metrics :UnblendedCost :Amount])) :estimated (:Estimated d)})
        current (filter #(and (not (.isBefore (:day %) first-day)) (.isBefore (:day %) today)) rows)
        previous (filter #(and (not (.isBefore (:day %) prev)) (.isBefore (:day %) first-day)) rows)
        total #(round4 (reduce + 0.0 (map :amount %)))
        estimated (fn [start end] (let [ds (filter #(let [d (date (get-in % [:TimePeriod :Start]))] (and (not (.isBefore d start)) (.isBefore d end))) days)] (when (seq ds) (boolean (some :Estimated ds)))))
        mtd (total current) window (.minusDays today 14) recent (filter #(and (not (.isBefore (:day %) window)) (.isBefore (:day %) today)) rows)
        top (set (keys (aggregate (map (juxt :service :amount) recent))))
        daily-map (reduce (fn [m {:keys [day service amount]}] (update-in m [(if (top service) service "Other") (str day)] (fnil + 0.0) amount)) {} recent)
        ;; Days come from ResultsByTime so a reported day without groups is a real 0, while a day Cost Explorer did not return is absent.
        window-days (->> days (map #(date (get-in % [:TimePeriod :Start]))) (filter #(and (not (.isBefore % window)) (.isBefore % today))) distinct sort (mapv str))
        daily-services (vec (sort (keys daily-map)))
        common {:schema schema :snapshot_id epoch} forecast-row (first (:ForecastResultsByTime forecast))
        f (if forecast-row {:available true :mean (round4 (+ mtd (Double/parseDouble (:MeanValue forecast-row)))) :lower (round4 (+ mtd (Double/parseDouble (:PredictionIntervalLowerBound forecast-row)))) :upper (round4 (+ mtd (Double/parseDouble (:PredictionIntervalUpperBound forecast-row))))} {:available false})]
    {:summary (merge common {:fetched_at epoch :data_through (str (.minusDays today 1)) :account_suffix suffix :linked_accounts (count (set (map :account rows))) :mtd_usd mtd :prev_month_total_usd (total previous) :prev_month_same_period_usd (total (filter #(.isBefore (:day %) prev-end) previous)) :estimated_current (estimated first-day today) :estimated_prev (estimated prev first-day) :forecast f :requests requests :pages (count pages)})
     :services (merge common {:services (update-vals (aggregate (map (juxt :service :amount) current)) round4)})
     ;; Matrix form keeps 14 days x 11 services well under the 4KB SSM standard limit (service names appear once).
     :daily (merge common {:days window-days :services daily-services
                           :values (mapv (fn [service] (mapv #(round4 (get-in daily-map [service %] 0.0)) window-days)) daily-services)})}))
;; SSM has no multi-parameter transaction. Remember what was attempted and restore the previous values on failure,
;; so a partial write never leaves daily/services/summary from different snapshots (previous snapshot is kept).
;; The final ok status is part of the same unit: if it cannot be written, the snapshot is rolled back too.
(defn write-snapshot! [put! previous result]
  (let [attempted (atom [])]
    (try (doseq [k (filter #(contains? result %) [:daily :services :summary :status])] (swap! attempted conj k) (put! (name k) (k result)))
         (catch Exception _
           (let [restored (mapv (fn [k] (try (put! (name k) (get previous k)) true (catch Exception _ false))) (reverse @attempted))]
             (throw (ex-info "SnapshotWriteFailed" {:code (if (every? true? restored) "SnapshotWriteFailed" "SnapshotRollbackFailed")})))))))
;; Any failure to read status must abort without writing status, otherwise the attempt history (24h/3 guard) would be erased.
(defn read-status [get-value]
  (let [v (try (json/parse-string (get-value "status") true) (catch Exception _ (throw (ex-info "StatusReadFailed" {:code "StatusReadFailed"}))))]
    (cond (not (map? v)) (throw (ex-info "StatusReadFailed" {:code "StatusReadFailed"}))
          (= "uninitialized" (:state v)) {}
          :else v)))
(defn main []
  (let [tmp (.toFile (if-let [d (System/getenv "RUNNER_TEMP")] (Files/createTempDirectory (.toPath (io/file d)) "aws-cost-" (make-array FileAttribute 0)) (Files/createTempDirectory "aws-cost-" (make-array FileAttribute 0))))
        now (.getEpochSecond (Instant/now)) today (LocalDate/now ZoneOffset/UTC) requests (atom 0) status (atom {}) status-loaded (atom false)]
    (try
      (letfn [(call [args] (let [out (io/file tmp "out") err (io/file tmp "err") p (process/process (into ["aws" "--no-cli-pager" "--output" "json"] args) {:out out :err err}) result @p]
                                  (when-not (zero? (:exit result)) (let [e (slurp err) code (or (second (re-find #"\(([A-Za-z]+)\)" e)) "AwsCliError")] (throw (ex-info "AWS error" {:code code}))))
                                  (json/parse-string (slurp out) true)))
              (put! [name value] (when-not (fits? value) (throw (ex-info "SizeLimitExceeded" {:code "SizeLimitExceeded"}))) (let [f (io/file tmp "value.json")] (spit f (json/generate-string value)) (call ["ssm" "put-parameter" "--name" (str "/lolice/aws-cost/" name) "--type" "SecureString" "--overwrite" "--value" (str "file://" (.getAbsolutePath f))])))
              (get-value [name] (-> (call ["ssm" "get-parameter" "--name" (str "/lolice/aws-cost/" name) "--with-decryption"]) :Parameter :Value))]
        (let [identity (call ["sts" "get-caller-identity"]) account (:Account identity)
              s (read-status get-value)
              g (guard s now)]
          (reset! status s) (reset! status-loaded true)
          (if (:skip g) (println "result=skipped")
            (do (swap! status assoc :schema schema :last_attempt_at now :last_result "pending" :attempts (conj (:attempts g) now) :requests_last 0)
                (put! "status" @status)
                (let [start (str (.minusMonths (.withDayOfMonth today 1) 1)) end (str today)
                      pages (loop [acc [] token nil] (let [args (cond-> ["ce" "get-cost-and-usage" "--no-paginate" "--time-period" (str "Start=" start ",End=" end) "--granularity" "DAILY" "--metrics" "UnblendedCost" "--group-by" "Type=DIMENSION,Key=SERVICE" "Type=DIMENSION,Key=LINKED_ACCOUNT"] token (into ["--next-page-token" token]))
                                                        _ (swap! requests inc) page (call args) next (:NextPageToken page) acc (conj acc page)] (page-decision (count acc) next) (if next (recur acc next) acc)))
                      forecast (try (swap! requests inc) (call ["ce" "get-cost-forecast" "--time-period" (str "Start=" today ",End=" (.plusMonths (.withDayOfMonth today 1) 1)) "--granularity" "MONTHLY" "--metric" "UNBLENDED_COST" "--prediction-interval-level" "80"]) (catch Exception _ nil))
                      result (transform today now (subs account (- (count account) 4)) pages forecast @requests)]
                  (doseq [k [:daily :services :summary]] (when-not (fits? (k result)) (throw (ex-info "SizeLimitExceeded" {:code "SizeLimitExceeded"}))))
                  (write-snapshot! put! (assoc (into {} (for [k [:daily :services :summary]] [k (json/parse-string (get-value (name k)) true)])) :status @status)
                                   (assoc result :status (assoc @status :last_success_at now :last_result "ok" :error_code nil :requests_last @requests)))
                  (println (str "result=ok pages=" (count pages) " requests=" @requests)))))))
      (catch Exception e (let [code (sanitize (or (:code (ex-data e)) "UnknownError"))] (when @status-loaded (try (swap! status assoc :schema schema :last_attempt_at now :last_result "error" :error_code code :requests_last @requests) (let [f (io/file tmp "error.json")] (spit f (json/generate-string @status)) @(process/process ["aws" "ssm" "put-parameter" "--name" "/lolice/aws-cost/status" "--type" "SecureString" "--overwrite" "--value" (str "file://" (.getAbsolutePath f))] {:out (io/file tmp "error-out") :err (io/file tmp "error-err")})) (catch Exception _))) (binding [*out* *err*] (println (str "result=error code=" code))) (System/exit 1)))
      (finally (doseq [f (reverse (file-seq tmp))] (.delete f))))))
(when (= *file* (System/getProperty "babashka.file")) (main))
