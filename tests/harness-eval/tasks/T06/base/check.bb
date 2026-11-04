#!/usr/bin/env bb
;; 受入用の独立検査。test.bb とは別に percentile を検証し、test.bb に percentile のテストがあることを確認する。
(require '[clojure.string :as str])
(load-file "stats.bb")
(def failures (atom 0))
(defn check [name expected actual]
  (if (= expected actual) (println "PASS" name) (do (println "FAIL" name "expected" expected "actual" actual) (swap! failures inc))))
(if (resolve 'percentile)
  (do
    (check "p50 odd" 3 (percentile [5 1 3 2 4] 0.5))
    (check "p50 even" 2 (percentile [4 3 2 1] 0.5))
    (check "p90" 9 (percentile (range 1 11) 0.9))
    (check "q=1 max" 10 (percentile (range 1 11) 1.0))
    (check "q=0 min" 1 (percentile [3 1 2] 0.0))
    (check "single" 7 (percentile [7] 0.9))
    (check "empty" nil (percentile [] 0.5)))
  (do (println "FAIL percentile not defined") (swap! failures inc)))
(check "mean kept" 2.0 (mean [1 2 3]))
(check "test.bb mentions percentile" true (>= (count (re-seq #"percentile" (slurp "test.bb"))) 3))
(System/exit (if (pos? @failures) 1 0))
