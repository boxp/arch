#!/usr/bin/env bb
(load-file "stats.bb")
(def failures (atom 0))
(defn check [name expected actual]
  (if (= expected actual) (println "PASS" name) (do (println "FAIL" name "expected" expected "actual" actual) (swap! failures inc))))
(check "mean" 2.0 (mean [1 2 3]))
(check "mean empty" nil (mean []))
(System/exit (if (pos? @failures) 1 0))
