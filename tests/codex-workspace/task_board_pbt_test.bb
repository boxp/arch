#!/usr/bin/env bb
(ns task-board-pbt-test
  (:require [clojure.test :as t :refer [deftest is]]
            [clojure.test.check :as tc]
            [clojure.test.check.generators :as gen]
            [clojure.test.check.properties :as prop]
            [clojure.spec.alpha :as s]
            [clojure.string :as str]
            [babashka.fs :as fs]))

(def root (-> *file* fs/parent fs/parent fs/parent str))
(defn load-into [ns-sym path]
  (binding [*ns* *ns*]
    (in-ns ns-sym)
    (clojure.core/refer-clojure)
    (load-file path)))
(load-into 'runner (str root "/docker/codex-workspace/task-board/task_board_runner.bb"))
(load-into 'task-board (str root "/docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb"))

(def seed (parse-long (or (System/getenv "TASK_BOARD_PBT_SEED") "20261102")))
(def num-tests (parse-long (or (System/getenv "TASK_BOARD_PBT_NUM_TESTS") "200")))
(def max-size (parse-long (or (System/getenv "TASK_BOARD_PBT_MAX_SIZE") "50")))
(defn check! [name property]
  (let [start (System/nanoTime)
        result (tc/quick-check num-tests property :seed seed :max-size max-size)
        elapsed (quot (- (System/nanoTime) start) 1000000)]
    (println (str "PBT " name " pass?=" (:pass? result) " num-tests=" (:num-tests result)
                  " seed=" seed " max-size=" max-size " elapsed-ms=" elapsed))
    (when-not (:pass? result)
      (println "  shrunk smallest:" (pr-str (get-in result [:shrunk :smallest])))
      (println "  original failing input:" (pr-str (:fail result)))
      (println (str "  reproduce: TASK_BOARD_PBT_SEED=" seed " bb tests/codex-workspace/task_board_pbt_test.bb")))
    result))

(def alphabet (vec (concat (map char (range 32 127)) [\タ \ス \ク \表 \示])))
(def part-gen (gen/fmap #(apply str %) (gen/vector (gen/elements (vec "abcdefghijklmnopqrstuvwxyz0123456789-")) 1 12)))
(def title-gen (gen/such-that (complement str/blank?)
                              (gen/fmap #(str/trim (apply str %)) (gen/vector (gen/elements alphabet) 1 40)) 100))
(s/def ::id (s/with-gen #(and (string? %) (boolean (re-matches #"BOXP-\d+" %)))
              #(gen/fmap (partial str "BOXP-") (gen/choose 1 99999))))
(s/def ::title (s/with-gen #(and (string? %) (not (str/blank? %)) (<= (count %) 40)
                                (= % (str/trim %)) (not (str/includes? % "\n")))
                 (constantly title-gen)))
(s/def ::lane (s/with-gen (set (keys task-board/lanes)) #(gen/elements (vec (keys task-board/lanes)))))
(s/def ::priority #{"low" "medium" "high"})
(s/def ::assignee (s/with-gen #(or (nil? %) (and (string? %) (boolean (re-matches #"[a-z0-9-]+" %))))
                    #(gen/one-of [(gen/return nil) part-gen])))
(def repo-gen (gen/fmap (fn [[a b]] (str a "/" b)) (gen/tuple part-gen part-gen)))
(s/def ::repo (s/with-gen #(and (vector? %) (<= (count %) 3)
                                 (every? (fn [x] (and (string? x) (re-matches #"[a-z0-9-]+/[a-z0-9-]+" x))) %))
                #(gen/vector repo-gen 0 3)))
(s/def ::card (s/keys :req-un [::id ::title ::lane ::priority ::assignee ::repo]))
(def card-gen (s/gen ::card))

(def roundtrip-property
  (prop/for-all [c card-gen]
    (let [p (task-board/parse-card (:lane c) (task-board/card-line c))]
      (and p (= (:id c) (:id p)) (= (:title c) (:title p)) (= (:lane c) (:lane p))
           (= (:priority c) (:priority p)) (= (:assignee c) (:assignee p))
           (= (:repo c) (:repo p)) (= (= "Done" (:lane c)) (:done p))))))

(def statuses (vec (vals runner/lane->status)))
(def extra-gen (gen/fmap (fn [[k v]] (str k "::" v))
                         (gen/tuple (gen/elements ["epic" "sprint" "zzz"]) part-gen)))
(def line-gen
  (gen/let [c card-gen extras (gen/vector extra-gen 0 3) stray gen/boolean
            existing (gen/elements statuses)]
    (str (str/replace (task-board/card-line c) #"status::[^\s]+" (str "status::" existing))
         (when (seq extras) (str " " (str/join " " extras)))
         (when stray " done::2026-01-02"))))
(defn tokens [line]
  (->> (str/replace (str/trim line) #"^-\s+\[[ xX]\]\s*" "")
       (#(str/split % #"\s+"))
       (remove #(re-matches #"(status|done)::.*" %))))
(def normalize-property
  (prop/for-all [line line-gen status (gen/elements statuses)]
    (let [n1 (runner/normalize-card-line line status)
          n2 (runner/normalize-card-line n1 status)]
      (and (= n1 n2) (= (frequencies (tokens line)) (frequencies (tokens n1)))
           (= status (runner/attr-value n1 "status"))
           (= (= "done" status) (boolean (runner/attr-value n1 "done")))
           (= (= "done" status) (boolean (re-find #"^- \[x\]" n1)))
           (boolean (re-find #"^- \[[ x]\]" n1))))))

(def lane-order ["Backlog" "Ready" "In Progress" "Blocked" "Review" "Done"])
(def section-gen
  (gen/let [before (gen/choose 0 2) cards (gen/vector card-gen 0 4) after (gen/choose 0 2)]
    {:before before :cards cards :after after}))
(def foreign-gen
  (gen/one-of [(gen/return nil)
               (gen/let [heading (gen/elements ["Notes" "Archive"]) cards (gen/vector card-gen 0 2)]
                 {:heading heading :cards cards})]))
(defn board-gen [foreign?]
  (gen/let [sections (gen/vector section-gen 6)
            foreign (if foreign? (gen/vector foreign-gen 6) (gen/return (vec (repeat 6 nil))))]
    (let [next-id (atom 0)
          render (fn [lane card]
                   (task-board/card-line (assoc card :lane lane :id (str "BOXP-" (swap! next-id inc)))))
          lines (mapcat (fn [lane section extra]
                          (concat [(str "## " lane)] (repeat (:before section) "")
                                  (map #(render lane %) (:cards section)) (repeat (:after section) "")
                                  (when extra
                                    (cons (str "## " (:heading extra))
                                          (map #(render lane %) (:cards extra))))))
                        lane-order sections foreign)]
      (vec (concat ["---" "kanban-plugin: board" "---" ""] lines)))))
(defn parsers-agree? [lines]
  (= (set (map (juxt :ticket-id :lane) (runner/parse-board-cards lines)))
     (set (map (juxt :id :lane) (task-board/board-cards (str (str/join "\n" lines) "\n"))))))
(def board-property (prop/for-all [lines (board-gen false)] (parsers-agree? lines)))
(def foreign-property (prop/for-all [lines (board-gen true)] (parsers-agree? lines)))

(deftest properties
  (doseq [[name property] [["card-render-parse-roundtrip" roundtrip-property]
                           ["normalize-card-line-idempotent-and-preserving" normalize-property]
                           ["runner-and-helper-board-parsers-agree" board-property]
                           ;; Promoted from exploratory after it found a real helper bug
                           ;; (see docs/project_docs/BOXP-381/results.md).
                           ["board-parsers-agree-with-foreign-headings" foreign-property]]]
    (let [result (check! name property)] (is (:pass? result) name))))

;; Deterministic regression for the shrunk counterexample found by
;; board-parsers-agree-with-foreign-headings (seed 20261102): the helper used to keep
;; the previous lane across a non-lane heading, so a card under "## Notes" after
;; "## Done" was reported as a Done card while the runner ignored it.
(deftest regression-card-under-foreign-heading-belongs-to-no-lane
  (let [lines ["---" "kanban-plugin: board" "---" ""
               "## Backlog" "## Ready" "## In Progress" "## Blocked" "## Review" "## Done"
               "## Notes"
               "- [x] [[Tickets/BOXP-1|BOXP-1: !]] #ticket status::done priority::low done::2026-11-02"]]
    (is (empty? (runner/parse-board-cards lines)))
    (is (empty? (task-board/board-cards (str (str/join "\n" lines) "\n"))))
    (is (parsers-agree? lines))))

(deftest mutant-unescaped-title-is-detected
  (with-redefs [task-board/encode-card-title identity]
    (let [result (tc/quick-check 200 roundtrip-property :seed 20261102 :max-size 50)]
      (println "Mutant shrunk smallest:" (pr-str (get-in result [:shrunk :smallest])))
      (is (false? (:pass? result)))
      (is (some? (get-in result [:shrunk :smallest]))))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [{:keys [fail error]} (t/run-tests 'task-board-pbt-test)]
    (System/exit (if (zero? (+ fail error)) 0 1))))
