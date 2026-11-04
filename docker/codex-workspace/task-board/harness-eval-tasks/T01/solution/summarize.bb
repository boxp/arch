#!/usr/bin/env bb
;; 引数の数値列を集計する小さなスクリプト。--json で JSON 1 行を出す。
(def args (vec *command-line-args*))
(def json? (some #(= "--json" %) args))
(def nums (map #(Long/parseLong %) (remove #(= "--json" %) args)))
(if json?
  (println (str "{\"count\":" (count nums) ",\"sum\":" (reduce + 0 nums) "}"))
  (println (str "count=" (count nums) " sum=" (reduce + 0 nums))))
