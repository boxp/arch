;; 小さな統計関数群。
(defn mean
  "数値列の平均。空なら nil。"
  [xs]
  (when (seq xs) (/ (reduce + 0.0 xs) (count xs))))
