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
(let [result (run-tests)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
