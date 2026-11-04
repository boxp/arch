#!/usr/bin/env bb
(require '[babashka.process :as p] '[clojure.string :as str])
(defn run [& args] (str/trim (:out @(p/process (into ["bb" "summarize.bb"] args) {:out :string :err :string}))))
(def failures (atom 0))
(defn check [name expected actual]
  (if (= expected actual) (println "PASS" name) (do (println "FAIL" name "expected" (pr-str expected) "actual" (pr-str actual)) (swap! failures inc))))
(check "plain" "count=3 sum=6" (run "1" "2" "3"))
(check "plain empty" "count=0 sum=0" (run))
(check "json" "{\"count\":3,\"sum\":6}" (run "--json" "1" "2" "3"))
(check "json flag last" "{\"count\":2,\"sum\":7}" (run "3" "4" "--json"))
(System/exit (if (pos? @failures) 1 0))
