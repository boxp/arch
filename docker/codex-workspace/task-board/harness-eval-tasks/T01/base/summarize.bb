#!/usr/bin/env bb
;; 引数の数値列を集計する小さなスクリプト。
(def nums (map #(Long/parseLong %) *command-line-args*))
(println (str "count=" (count nums) " sum=" (reduce + 0 nums)))
