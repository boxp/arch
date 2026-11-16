;; 小さな統計関数群。
(defn mean
  "数値列の平均。空なら nil。"
  [xs]
  (when (seq xs) (/ (reduce + 0.0 xs) (count xs))))

(defn percentile
  "nearest-rank 法の分位。xs を昇順に並べ ceil(q*n)-1 番目 (0 未満は 0) を返す。空なら nil。"
  [xs q]
  (when (seq xs)
    (let [sorted (vec (sort xs))
          n (count sorted)
          idx (max 0 (dec (long (Math/ceil (* q n)))))]
      (nth sorted (min idx (dec n))))))
