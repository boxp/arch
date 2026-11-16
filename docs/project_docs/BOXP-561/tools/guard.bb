#!/usr/bin/env bb
(require '[babashka.fs :as fs] '[clojure.string :as str] '[clojure.java.io :as io] '[clojure.edn :as edn])
(import '[java.security MessageDigest])
(load-file (str (.getParent (io/file (System/getProperty "babashka.file"))) "/tmp.bb"))
(def vault "/home/boxp/Documents/obsidian-headless/BOXP")
(defn digest [f] (let [d (MessageDigest/getInstance "SHA-256") b (byte-array 65536)] (with-open [in (io/input-stream f)] (loop [] (let [n (.read in b)] (when (pos? n) (.update d b 0 n) (recur))))) (format "%064x" (BigInteger. 1 (.digest d)))))
(defn snapshot []
  (let [dirs [(str vault "/ひとはこさんバース") (str vault "/小説草案/AI執筆")]
        roots (mapcat #(if (fs/directory? %) (file-seq (io/file %)) (throw (ex-info "protected directory missing" {}))) dirs)
        drafts (or (seq (.listFiles (io/file (str vault "/小説草案")))) [])
        files (concat roots drafts [(io/file (str vault "/Tickets/BOXP-382.md")) (io/file (str vault "/Boards/Task Board.md"))])
        board (slurp (str vault "/Boards/Task Board.md"))]
    {:files (into (sorted-map) (map (fn [f] [(str (fs/relativize vault f)) (digest f)]) (filter #(and (.isFile %) (not (fs/sym-link? %))) files))) :eval-card-count (count (re-seq #"EVAL561-[A-Za-z0-9-]+" board))}))
(let [[op path] *command-line-args*]
 (when-not (and (#{"snapshot" "verify"} op) path (= 2 (count *command-line-args*)) (under-tmp? path)) (binding [*out* *err*] (println "usage: guard.sh snapshot|verify FILE")) (System/exit 2))
 (let [current (snapshot)]
  (if (= op "snapshot") (do (when (fs/exists? path) (throw (ex-info "snapshot exists" {}))) (spit path (pr-str current)) (println (str "files=" (count (:files current)) " eval_cards=" (:eval-card-count current))) (when (pos? (:eval-card-count current)) (System/exit 1)))
   (let [old (edn/read-string (slurp path)) a (:files old) b (:files current) added (count (remove #(contains? a %) (keys b))) removed (count (remove #(contains? b %) (keys a))) changed (count (filter #(and (contains? b %) (not= (a %) (b %))) (keys a))) cards (:eval-card-count current)]
    (println (str "changed=" changed " added=" added " removed=" removed " eval_cards=" cards))
    (when (or (pos? (+ added removed changed cards)) (pos? (:eval-card-count old))) (System/exit 1))))))
