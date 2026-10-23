#!/usr/bin/env bb

;; Summarize run_eval.bb results into Markdown with denominators.
;;   bb report.bb --results "H3 v1=/tmp/eval-full/h3" --results "H2=/tmp/eval-full/h2" ...

(require '[babashka.fs :as fs] '[clojure.edn :as edn] '[clojure.string :as str])

(def args (vec *command-line-args*))
(def inputs (->> (keep-indexed (fn [i a] (when (= a "--results") (nth args (inc i)))) args)
                 (map #(let [[label path] (str/split % #"=" 2)] {:label label :path path}))
                 vec))
(def here (str (fs/parent (fs/canonicalize *file*))))
(def cases-file (let [i (.indexOf args "--cases")] (if (>= i 0) (nth args (inc i)) "cases.edn")))
(def cases (edn/read-string (slurp (str (fs/path here cases-file)))))

(defn load-results [path]
  (let [f (fs/path path "results.edn")]
    (if (fs/exists? f)
      (edn/read-string (slurp (str f)))
      (vec (for [r (fs/glob path "*/rep*/result.edn")] (edn/read-string (slurp (str r))))))))

(def data (mapv #(assoc % :results (load-results (:path %))) inputs))

(defn cell [results case-id]
  (let [rs (filter #(= case-id (:case %)) results)
        n (count rs) p (count (filter :pass? rs))]
    (if (zero? n) "–" (str p "/" n))))

(defn secs [results case-id]
  (let [rs (filter #(= case-id (:case %)) results)
        ms (keep :llm-elapsed-ms rs)]
    (if (seq ms) (str (quot (quot (reduce + ms) (count ms)) 1000)) "–")))

(defn tokens [results case-id]
  (let [rs (filter #(= case-id (:case %)) results)
        pt (keep #(get-in % [:usage :prompt_tokens]) rs)
        ct (keep #(get-in % [:usage :completion_tokens]) rs)]
    (if (seq pt) (str (quot (reduce + pt) (count pt)) "+" (quot (reduce + ct) (max 1 (count ct)))) "–")))

(println (str "| case | 内容 | 区分 | " (str/join " | " (map :label data)) " |"))
(println (str "|---|---|---|" (apply str (repeat (count data) "---|"))))
(doseq [c cases]
  (println (str "| " (:id c) " | " (:title c) " | " (:group c) " | "
                (str/join " | " (map #(cell (:results %) (:id c)) data)) " |")))
(println)
(println "合計（分母付き）:")
(doseq [{:keys [label results]} data]
  (let [by-group (group-by (fn [r] (:group (first (filter #(= (:id %) (:case r)) cases)))) results)]
    (println (str "- " label ": " (count (filter :pass? results)) "/" (count results)
                  "（" (str/join "、" (for [[g rs] (sort-by key by-group)] (str g " " (count (filter :pass? rs)) "/" (count rs)))) "）"
                  "; 失敗種別: " (let [kinds (frequencies (map :kind (mapcat :failures results)))]
                                  (if (seq kinds) (str/join ", " (for [[k v] kinds] (str (name k) "×" v))) "なし"))
                  "; llm 合計 " (quot (reduce + (keep :llm-elapsed-ms results)) 1000) " 秒"
                  "; tokens prompt " (reduce + (keep #(get-in % [:usage :prompt_tokens]) results))
                  " / completion " (reduce + (keep #(get-in % [:usage :completion_tokens]) results))))))
(println)
(println "ケース別 所要秒 (llm 平均) / tokens (prompt+completion 平均):")
(println (str "| case | " (str/join " | " (mapcat (fn [d] [(str (:label d) " 秒") (str (:label d) " tok")]) data)) " |"))
(println (str "|---|" (apply str (repeat (* 2 (count data)) "---|"))))
(doseq [c cases]
  (println (str "| " (:id c) " | " (str/join " | " (mapcat (fn [d] [(secs (:results d) (:id c)) (tokens (:results d) (:id c))]) data)) " |")))
(println)
(println "失敗の内訳:")
(doseq [{:keys [label results]} data
        r (sort-by (juxt :case :rep) results)
        :when (not (:pass? r))]
  (println (str "- " label " " (:case r) " rep" (:rep r) " (" (:status r) "): "
                (str/join " / " (map #(str (name (:kind %)) ": " (subs (:message %) 0 (min 160 (count (:message %))))) (:failures r))))))
