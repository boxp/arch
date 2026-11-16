#!/usr/bin/env bb
(load-file "stats.bb")
(def failures (atom 0))
(defn check [name expected actual]
  (if (= expected actual) (println "PASS" name) (do (println "FAIL" name "expected" expected "actual" actual) (swap! failures inc))))
(check "mean" 2.0 (mean [1 2 3]))
(check "mean empty" nil (mean []))
(check "percentile median" 3 (percentile [5 1 3 2 4] 0.5))
(check "percentile q=1 max" 10 (percentile (range 1 11) 1.0))
(check "percentile empty" nil (percentile [] 0.5))
(System/exit (if (pos? @failures) 1 0))
