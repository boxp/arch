;; 観測窓の判定。start / now は epoch 秒。
(defn in-window?
  "start が [now - window-seconds, now) に入るとき true。"
  [start now window-seconds]
  (and (> start (- now window-seconds))
       (<= start now)))
