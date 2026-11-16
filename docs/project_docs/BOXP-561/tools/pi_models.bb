#!/usr/bin/env bb
(require '[clojure.java.io :as io] '[cheshire.core :as json])
(load-file (str (.getParent (io/file (System/getProperty "babashka.file"))) "/tmp.bb"))
(let [[port out] *command-line-args* n (try (parse-long (or port "")) (catch Exception _ nil))]
  (when-not (and (= 2 (count *command-line-args*)) n (<= 1 n 65535) out (under-tmp? out))
    (binding [*out* *err*] (println "usage: pi_models.bb PORT OUT")) (System/exit 2))
  (let [cfg (json/parse-string (slurp "/etc/pi-agent-config/models.json") true)
        models (get-in cfg [:providers :llama.cpp :models]) template (some #(when (= "qwen3-coder-next" (:id %)) %) models)]
    (when-not template (throw (ex-info "qwen3-coder-next missing" {})))
    (let [ids ["qwen3-coder-next" "qwen38-flash-next" "qwen38-27b"]
          models (into (vec (remove #(some #{(:id %)} ids) models)) (map #(assoc template :id % :name %) ids))]
      (spit out (json/generate-string (-> cfg (assoc-in [:providers :llama.cpp :baseUrl] (str "http://127.0.0.1:" n "/v1")) (assoc-in [:providers :llama.cpp :models] models)) {:pretty true})))))
