#!/usr/bin/env bb
(load-file "window.bb")
(def failures (atom 0))
(defn check [name expected actual]
  (if (= expected actual) (println "PASS" name) (do (println "FAIL" name "expected" expected "actual" actual) (swap! failures inc))))
(check "inside" true (in-window? 150 200 100))
(check "lower bound inclusive" true (in-window? 100 200 100))
(check "below lower bound" false (in-window? 99 200 100))
(check "upper bound exclusive" false (in-window? 200 200 100))
(check "just below now" true (in-window? 199 200 100))
(check "future" false (in-window? 201 200 100))
(System/exit (if (pos? @failures) 1 0))
