#!/usr/bin/env bb
(require '[clojure.java.io :as io] '[clojure.string :as str] '[babashka.fs :as fs] '[babashka.process :as p] '[cheshire.core :as json])
(import '[java.time Instant ZonedDateTime ZoneId] '[java.time.format DateTimeFormatter])
(load-file (str (.getParent (io/file (System/getProperty "babashka.file"))) "/tmp.bb"))
(let [[model root out port] *command-line-args* n (try (parse-long (or port "")) (catch Exception _ nil))]
  (when-not (and (= 4 (count *command-line-args*)) (#{"qwen3-coder-next" "qwen38-flash-next" "qwen38-27b"} model) root out n (<= 1 n 65535) (under-tmp? root) (under-tmp? out) (not (fs/exists? out)) (fs/exists? (str root "/manifest.before")) (fs/exists? (str root "/prompt.md")))
    (binding [*out* *err*] (println "usage: novel_singleshot.bb MODEL ROOT OUTDIR PORT")) (System/exit 2))
  (let [obs (System/getenv "BOXP561_OBS_DIR")]
    (when-not (and obs (under-tmp? obs) (fs/directory? obs) (not (fs/exists? (str obs "/ABORT")))) (throw (ex-info "observer missing or aborted" {})))
    (fs/create-dirs out)
    ;; agent と同じ開始資料を渡す: 設定に加えて着想メモ.md と既存の小説草案(AI執筆含む)も含める
    (let [dirs (map #(io/file root %) ["着想メモ.md" "設定" "ひとはこさんバース/世界観設定" "ひとはこさんバース/キャラ設定" "ひとはこさんバース/アイテム設定" "小説草案"])
          md? (fn [f] (and (.isFile f) (not (fs/sym-link? f)) (str/ends-with? (str f) ".md")))
          files (distinct (mapcat #(cond (.isDirectory %) (sort-by str (filter md? (file-seq %))) (md? %) [%] :else []) dirs))
          prompt (str (slurp (str root "/prompt.md")) "\n以下は作業ディレクトリ内の開始資料(着想メモ・設定資料・既存の小説草案)です。\n" (str/join "\n" (map #(str "\n# " (fs/relativize root %) "\n" (slurp %)) files)) "\n出力は小説ファイルの内容だけにしてください。")
          request (json/generate-string {:model model :messages [{:role "user" :content prompt}] :temperature 0.7 :max_tokens 8192})
          start (Instant/now) begin (System/nanoTime)
          child (p/process ["curl" "--fail" "--silent" "--show-error" "--max-time" "3600" "-H" "Content-Type: application/json" "--data-binary" "@-" (str "http://127.0.0.1:" n "/v1/chat/completions")] {:in request :out :string :err :string})]
      (while (and (.isAlive (:proc child)) (not (fs/exists? (str obs "/ABORT")))) (Thread/sleep 1000))
      (when (fs/exists? (str obs "/ABORT")) (.destroyForcibly (:proc child)))
      (let [{:keys [exit out err]} @child end (Instant/now) elapsed (/ (- (System/nanoTime) begin) 1e9)]
        (when-not (zero? exit) (throw (ex-info "request failed or aborted" {:exit exit})))
        (let [response (json/parse-string out true) content (get-in response [:choices 0 :message :content]) stamp (.format (ZonedDateTime/now (ZoneId/of "Asia/Tokyo")) (DateTimeFormatter/ofPattern "yyyy-MM-dd-HH-mm")) dest (str root "/小説草案/AI執筆/" stamp "_singleshot.md")]
          (when-not (string? content) (throw (ex-info "response has no content" {})))
          (when (fs/exists? dest) (throw (ex-info "output already exists" {})))
          (spit dest content)
          (spit (str (nth *command-line-args* 2) "/meta.json") (json/generate-string {:start-utc (str start) :end-utc (str end) :wall-seconds elapsed :usage (select-keys (:usage response) [:prompt_tokens :completion_tokens :total_tokens])}))
          (let [result (p/sh (str (.getParent (io/file (System/getProperty "babashka.file"))) "/novel_check.bb") root)]
            (spit (str (nth *command-line-args* 2) "/check.json") (:out result))
            (when-not (zero? (:exit result)) (System/exit 1))))))))
