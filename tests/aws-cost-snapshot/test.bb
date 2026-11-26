(require '[clojure.test :refer [deftest is run-tests]])
(load-file "scripts/aws-cost-snapshot/snapshot.bb")
(deftest helpers
  (is (= "BadCode" (sanitize "Bad-123 Code")))
  (is (not (fits? {:x (apply str (repeat 4001 "x"))})))
  (is (:skip (guard {:last_success_at 900} 1000)))
  (is (:skip (guard {:attempts [1 2 3]} 4)))
  (is (thrown? Exception (page-decision 5 "next")))
  (is (= 11 (count (aggregate (map #(vector (str %) %) (range 12)))))))
(deftest dates-and-transform
  (let [mk (fn [d service amount] {:TimePeriod {:Start d} :Estimated true :Groups [{:Keys [service "123"] :Metrics {:UnblendedCost {:Amount amount}}}]})
        pages [{:ResultsByTime [(mk "2024-02-28" "A" "2") (mk "2024-02-29" "B" "3") (mk "2024-03-01" "A" "4")]}]
        x (transform (date "2024-03-31") 1711843200 "1234" pages nil 2)
        first-day (transform (date "2024-03-01") 1709251200 "1234" pages nil 2)]
    (is (= 5.0 (get-in x [:summary :prev_month_same_period_usd])))
    (is (= false (get-in x [:summary :forecast :available])))
    (is (empty? (get-in x [:daily :days])))
    (is (= 0.0 (get-in first-day [:summary :mtd_usd])))
    (is (nil? (get-in first-day [:summary :estimated_current])))))
(deftest window-and-forecast
  (let [mk (fn [d amount] {:TimePeriod {:Start d} :Estimated false :Groups [{:Keys ["A" "123"] :Metrics {:UnblendedCost {:Amount amount}}}]})
        pages [{:ResultsByTime [(mk "2024-03-01" "1") (mk "2024-03-02" "2") (mk "2024-03-15" "3")]}]
        forecast {:ForecastResultsByTime [{:MeanValue "4" :PredictionIntervalLowerBound "3" :PredictionIntervalUpperBound "5"}]}
        x (transform (date "2024-03-16") 1710547200 "1234" pages forecast 2)]
    (is (= ["2024-03-02" "2024-03-15"] (get-in x [:daily :days])))
    (is (= [[2.0 3.0]] (get-in x [:daily :values])))
    (is (= 10.0 (get-in x [:summary :forecast :mean])))
    (is (= 9.0 (get-in x [:summary :forecast :lower])))
    (is (= 11.0 (get-in x [:summary :forecast :upper])))))
(deftest daily-fits-4kb
  (let [services (map #(str "Amazon Example Service With A Fairly Long Name " %) (range 30))
        days (for [d (range 1 31)] {:TimePeriod {:Start (format "2024-03-%02d" d)} :Estimated true
                                    :Groups (for [s services] {:Keys [s "123"] :Metrics {:UnblendedCost {:Amount "12345.678901"}}})})
        x (transform (date "2024-03-31") 1711843200 "1234" [{:ResultsByTime days}] nil 1)]
    (is (= 14 (count (get-in x [:daily :days]))))
    (is (= 11 (count (get-in x [:daily :services]))))
    (is (every? fits? (vals x)))))
(deftest write-rollback
  (let [store (atom {"daily" :old-d "services" :old-s "summary" :old-m})
        put! (fn [n v] (when (= v :new-s) (throw (ex-info "x" {:code "Throttling"}))) (swap! store assoc n v))
        prev {:daily :old-d :services :old-s :summary :old-m}
        e (try (write-snapshot! put! prev {:daily :new-d :services :new-s :summary :new-m}) nil (catch Exception e e))]
    (is (= "SnapshotWriteFailed" (:code (ex-data e))))
    (is (= {"daily" :old-d "services" :old-s "summary" :old-m} @store)))
  (let [put! (fn [n v] (when (#{:new-s :old-d} v) (throw (ex-info "x" {}))))
        e (try (write-snapshot! put! {:daily :old-d} {:daily :new-d :services :new-s :summary :new-m}) nil (catch Exception e e))]
    (is (= "SnapshotRollbackFailed" (:code (ex-data e)))))
  (let [store (atom {})
        put! (fn [n v] (when (= v :ok-status) (throw (ex-info "x" {}))) (swap! store assoc n v))
        e (try (write-snapshot! put! {:daily :old-d :services :old-s :summary :old-m :status :pending}
                                {:daily :new-d :services :new-s :summary :new-m :status :ok-status}) nil (catch Exception e e))]
    (is (= "SnapshotWriteFailed" (:code (ex-data e))))
    (is (= {"daily" :old-d "services" :old-s "summary" :old-m "status" :pending} @store))))
(deftest status-read
  (is (= {} (read-status (constantly "{\"state\":\"uninitialized\"}"))))
  (is (= [1 2] (:attempts (read-status (constantly "{\"attempts\":[1,2]}")))))
  (is (= "StatusReadFailed" (:code (ex-data (try (read-status (fn [_] (throw (ex-info "t" {:code "Throttling"})))) (catch Exception e e))))))
  (is (= "StatusReadFailed" (:code (ex-data (try (read-status (constantly "not json")) (catch Exception e e)))))))
(deftest ce-single-attempt
  (is (= "1" (get (cli-env ["ce" "get-cost-and-usage"]) "AWS_MAX_ATTEMPTS")))
  (is (= "1" (get (cli-env ["ce" "get-cost-forecast"]) "AWS_MAX_ATTEMPTS")))
  (is (nil? (cli-env ["ssm" "put-parameter"]))))
(deftest s3-usage-transform-spec
  ;; 仕様例(BOXP-598): 直近14日(today-14〜today-1)の日別、使用タイプ別の費用と使用量。窓外の日は入れない。
  (let [mk (fn [d groups] {:TimePeriod {:Start d} :Estimated true
                           :Groups (for [[k cost qty] groups] {:Keys [k] :Metrics {:UnblendedCost {:Amount cost} :UsageQuantity {:Amount qty}}})})
        page {:ResultsByTime [(mk "2024-03-01" [["A" "9" "90"]]) (mk "2024-03-02" [["A" "1" "10"]]) (mk "2024-03-15" [["B" "2" "5"]])]}
        x (s3-usage-transform (date "2024-03-16") 1710547200 page)]
    (is (= {:schema schema :snapshot_id 1710547200 :available true
            :days ["2024-03-02" "2024-03-15"] :usage_types ["A" "B"]
            :values [[1.0 0.0] [0.0 2.0]] :quantities [[10.0 0.0] [0.0 5.0]]} x)))
  ;; 12 種あれば費用上位 10 種＋Other。Other の使用量は単位が混ざるので null。
  (let [groups (for [i (range 12)] [(format "T%02d" i) (str (inc i)) "1"])
        x (s3-usage-transform (date "2024-03-16") 1 {:ResultsByTime [{:TimePeriod {:Start "2024-03-15"} :Groups (for [[k c q] groups] {:Keys [k] :Metrics {:UnblendedCost {:Amount c} :UsageQuantity {:Amount q}}})}]})]
    (is (= 11 (count (:usage_types x))))
    (is (some #{"Other"} (:usage_types x)))
    (is (not (some #{"T00" "T01"} (:usage_types x))))
    (is (= [3.0] (nth (:values x) (.indexOf (:usage_types x) "Other"))))
    (is (= [nil] (nth (:quantities x) (.indexOf (:usage_types x) "Other")))))
  ;; 続きページがあれば取りこぼしなので使わない（追加リクエストはしない）。
  (is (= "PageLimitExceeded" (:code (ex-data (try (s3-usage-transform (date "2024-03-16") 1 {:ResultsByTime [] :NextPageToken "t"}) (catch Exception e e)))))))
(deftest s3-usage-fits-4kb
  (let [types (map #(str "APN1-ExampleUsageType-WithLongName-" %) (range 30))
        days (for [d (range 1 31)] {:TimePeriod {:Start (format "2024-03-%02d" d)}
                                    :Groups (for [t types] {:Keys [t] :Metrics {:UnblendedCost {:Amount "12345.678901"} :UsageQuantity {:Amount "123456789.123456"}}})})
        x (s3-usage-transform (date "2024-03-31") 1 {:ResultsByTime days})]
    (is (fits? x))
    (is (= 11 (count (:values x))))))
(deftest s3-usage-failure-is-isolated
  ;; S3 内訳の失敗は全体の取得を失敗させず、available=false と理由だけを保存する。
  (is (= {:schema schema :snapshot_id 7 :available false :error_code "Throttling"}
         (s3-usage-snapshot 7 (fn [] (throw (ex-info "x" {:code "Throttling"}))) (fn [_] (throw (ex-info "unreachable" {}))))))
  (is (= {:schema schema :snapshot_id 7 :available false :error_code "PageLimitExceeded"}
         (s3-usage-snapshot 7 (constantly {:NextPageToken "t"}) #(s3-usage-transform (date "2024-03-16") 7 %)))))
(deftest s3-usage-request-args
  (let [args (s3-usage-args (date "2024-03-16"))]
    (is (= ["ce" "get-cost-and-usage"] (take 2 args)))
    (is (some #{"Start=2024-03-02,End=2024-03-16"} args))
    (is (some #{"Type=DIMENSION,Key=USAGE_TYPE"} args))
    (is (some #(and (string? %) (str/includes? % "Amazon Simple Storage Service")) args))
    (is (= "1" (get (cli-env args) "AWS_MAX_ATTEMPTS")))))
(deftest write-order-includes-s3-usage
  (let [order (atom [])]
    (write-snapshot! (fn [n _] (swap! order conj n)) {} {:daily 1 :services 2 :s3_usage 3 :summary 4 :status 5})
    (is (= ["daily" "services" "s3_usage" "summary" "status"] @order))))
(let [result (run-tests)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
