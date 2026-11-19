#!/usr/bin/env bb
;; BOXP-616: mutation testing for the Task Board runner's safety boundaries.
;;
;; A thin, self-contained mutation runner: it changes one expression at a time in
;; the functions listed in task-board-mutation-targets.edn and runs the tests that
;; reach that function. Every mutant runs in a copy of the repository files under
;; the output directory; the checkout, the real runner and any real vault are never
;; written. See docs/project_docs/BOXP-616/plan.md for how to read the result.
;;
;;   bb tests/codex-workspace/task-board-mutation.bb --list
;;   bb tests/codex-workspace/task-board-mutation.bb [--group NAME] [--fn NAME] [--jobs N] [--max-cases N] [--out DIR]
;;     --max-cases N: run at most the N fastest runner cases that reach a function (default: all)
;;     --direct-only: skip the runner cases (a quick loop while writing tests; survivors are candidates only)
;;   bb tests/codex-workspace/task-board-mutation.bb --self-test
(ns task-board-mutation
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.edn :as edn]
            [clojure.string :as str]
            [rewrite-clj.node :as n]
            [rewrite-clj.parser :as parser]
            [rewrite-clj.zip :as z]))

(def root (-> *file* fs/absolutize fs/parent fs/parent fs/parent str))

;; ---------------------------------------------------------------------------
;; Mutation operators

(def symbol-swaps
  "Function-position replacements: each one keeps the form valid and changes a decision."
  {'= ['not=] 'not= ['=] '< ['<= '>] '<= ['< '>=] '> ['>= '<] '>= ['> '<=]
   'and ['or] 'or ['and] 'when ['when-not] 'when-not ['when] 'if ['if-not] 'if-not ['if]
   'inc ['dec] 'dec ['inc] '+ ['-] '- ['+] 'max ['min] 'min ['max]
   'empty? ['seq] 'seq ['empty?] 'nil? ['some?] 'some? ['nil?]
   'every? ['some] 'some ['every?] 'filter ['remove] 'remove ['filter] 'filterv ['(comp vec remove)]
   'str/blank? ['(complement clojure.string/blank?)] 'contains? ['(complement contains?)]})

(defn token-value [zloc]
  (when (= :token (z/tag zloc)) (z/sexpr zloc)))

(defn call-position? [zloc]
  (and (= :list (some-> zloc z/up z/tag)) (nil? (z/left zloc))))

(defn regex-variants
  "Drop an anchor, one flag or the optional whitespace: markers and parsers are often
  only safe because of them."
  [pattern]
  (let [flags (second (re-find #"^\(\?([a-z]+)\)" pattern))]
    (distinct
     (remove #(= % pattern)
             (concat
              [(str/replace-first pattern #"^(\(\?[a-z]+\))?\^" "$1")
               (str/replace pattern #"\$$" "")
               (str/replace pattern #"\\s\*" "")]
              (for [c flags
                    :let [rest-flags (str/replace flags (str c) "")]]
                (str/replace-first pattern #"^\(\?[a-z]+\)"
                                   (if (str/blank? rest-flags) "" (str "(?" rest-flags ")")))))))))

(defn node-mutations
  "[[description replacement-node] ...] for one location."
  [zloc]
  (let [tag (z/tag zloc)
        v (token-value zloc)]
    (concat
     (when (and (symbol? v) (call-position? zloc))
       (for [r (get symbol-swaps v)] [(str v " -> " (pr-str r)) (parser/parse-string (pr-str r))]))
     (when (boolean? v) [[(str v " -> " (not v)) (n/token-node (not v))]])
     (when (and (int? v) (not (call-position? zloc)))
       [[(str v " -> " (inc v)) (n/token-node (inc v))]
        [(str v " -> " (if (zero? v) -1 0)) (n/token-node (if (zero? v) -1 0))]])
     (when (= :regex tag)
       (for [r (regex-variants (let [t (n/string (z/node zloc))] (subs t 2 (dec (count t)))))]
         [(str "regex -> #\"" r "\"") (parser/parse-string (str "#\"" r "\""))]))
     (when (= :list tag)
       (let [[head & args] (z/child-sexprs zloc)]
         (concat
          (when (and (= 'not head) (= 1 (count args)))
            [["(not x) -> x" (z/node (z/right (z/down zloc)))]])
          ;; Drop one test/expression pair of a cond (the last pair stays).
          (when (and (= 'cond head) (even? (count args)) (> (count args) 2))
            (let [kids (vec (rest (z/child-sexprs zloc)))
                  nodes (vec (rest (n/children (z/node zloc))))
                  forms (vec (remove #(contains? #{:whitespace :newline :comment} (n/tag %)) nodes))]
              (for [i (range 0 (- (count kids) 2) 2)]
                [(str "drop cond clause " (inc (quot i 2)) " " (pr-str (first (str/split-lines (n/string (forms i))))))
                 (n/list-node (interpose (n/spaces 1)
                                         (cons (n/token-node 'cond)
                                               (concat (subvec forms 0 i) (subvec forms (+ i 2))))))]))))))
     (when (and (= :set tag) (> (count (z/child-sexprs zloc)) 1))
       (let [forms (vec (remove #(contains? #{:whitespace :newline :comment} (n/tag %)) (n/children (z/node zloc))))]
         (for [i (range (count forms))]
           [(str "drop set element " (n/string (forms i)))
            (n/set-node (interpose (n/spaces 1) (concat (subvec forms 0 i) (subvec forms (inc i)))))]))))))

;; ---------------------------------------------------------------------------
;; Locating the target functions

(defn parse-file [text] (z/of-string text {:track-position? true}))

(defn defn-name [zloc]
  (when (= :list (z/tag zloc))
    (let [head (some-> zloc z/down)]
      (when (contains? #{'defn 'defn-} (token-value head))
        (some-> head z/right token-value)))))

(defn find-defn [zloc fname]
  (loop [loc zloc]
    (cond (nil? loc) nil
          (= fname (defn-name loc)) loc
          :else (recur (z/right loc)))))

(defn children [loc]
  (when (z/down loc) (take-while some? (iterate z/right (z/down loc)))))

(defn walk [loc]
  (cons loc (mapcat walk (when (#{:list :vector :map :set :fn :quote :syntax-quote :meta} (z/tag loc)) (children loc)))))

(defn body-locations
  "Every location inside a defn after its name and docstring, depth first. The locations
  stay in the whole-file zipper, so a replacement keeps the rest of the file."
  [defn-loc]
  (let [[_ _ & forms] (children defn-loc)
        forms (if (and (= :token (some-> (first forms) z/tag)) (string? (z/sexpr (first forms))) (next forms))
                (rest forms) forms)]
    (vec (mapcat walk forms))))

(defn mutants-for [text fname]
  (let [d (find-defn (parse-file text) fname)]
    (when-not d (throw (ex-info (str "function not found: " fname) {:fn fname})))
    (vec (for [[i loc] (map-indexed vector (body-locations d))
               [j [desc _]] (map-indexed vector (node-mutations loc))]
           {:fn (str fname) :loc i :variant j :desc desc
            :line (first (z/position loc)) :original (first (str/split-lines (z/string loc)))}))))

(defn apply-mutant [text {:keys [fn loc variant]}]
  (let [d (find-defn (parse-file text) (symbol fn))
        target (nth (body-locations d) loc)
        [_ replacement] (nth (vec (node-mutations target)) variant)]
    (z/root-string (z/replace target replacement))))

;; Coverage: one line at the top of every target body, written only when the
;; variable is set. It shows which runner test cases reach which function.
(defn instrument [text fnames]
  (reduce
   (fn [text fname]
     (let [d (find-defn (parse-file text) fname)
           probe (parser/parse-string
                  (str "(clojure.core/when-let [tbm-p (System/getenv \"TB_MUTATION_COVERAGE\")]"
                       " (clojure.core/spit tbm-p \"" fname "\\n\" :append true))"))
           arg-vectors (fn [loc]
                         (let [kids (take-while some? (iterate z/right (z/down loc)))]
                           (if-let [v (first (filter #(= :vector (z/tag %)) kids))]
                             [v]
                             (keep #(when (and (= :list (z/tag %)) (= :vector (some-> % z/down z/tag))) (z/down %)) kids))))]
       (if-let [v (first (arg-vectors d))]
         ;; Insert into the first arity only when there are several: enough to see reachability.
         (z/root-string (z/insert-right v probe))
         text)))
   text fnames))

;; ---------------------------------------------------------------------------
;; Running tests in an isolated copy

(defn clean-env []
  (let [env (into {} (System/getenv))]
    (->> env
         (remove (fn [[k _]] (or (str/starts-with? k "CODEX_TASK_BOARD_")
                                 (str/starts-with? k "TB_MUTATION_")
                                 (contains? #{"TASK_BOARD_TEST_ONLY" "TASK_BOARD_TEST_SHARD" "TASK_BOARD_TEST_SHARDS"} k))))
         (into {}))))

(defn make-sandbox! [config dir]
  (fs/delete-tree dir)
  (fs/create-dirs dir)
  (doseq [rel (:copy config)]
    (let [src (fs/path root rel) dst (fs/path dir rel)]
      (fs/create-dirs (fs/parent dst))
      (if (fs/directory? src) (fs/copy-tree src dst {:copy-attributes true}) (fs/copy src dst {:copy-attributes true}))))
  (fs/create-dirs (fs/path dir ".tmp"))
  (str dir))

(defn run-cmd
  "Run one test command in the sandbox. Returns {:status :pass|:fail|:timeout :ms n}."
  [sandbox cmd extra-env timeout-ms]
  (let [start (System/currentTimeMillis)
        proc (apply p/process {:dir sandbox :out :string :err :out
                         :env (merge (clean-env) {"TMPDIR" (str sandbox "/.tmp")} extra-env)}
                        cmd)
        res (deref proc timeout-ms ::timeout)
        ms (- (System/currentTimeMillis) start)]
    (if (= ::timeout res)
      (do (p/destroy-tree proc) {:status :timeout :ms ms})
      {:status (if (zero? (:exit res)) :pass :fail) :ms ms :out (:out res)})))

(defn case-cmd [c] ["bash" "tests/codex-workspace/task-board-runner-test.sh" :case c])

(defn resolve-cmd [cmd]
  (if (= :case (get cmd 2))
    {:cmd (subvec cmd 0 2) :env {"TASK_BOARD_TEST_ONLY" (nth cmd 3)}}
    {:cmd cmd :env {}}))

(defn runner-cases []
  (vec (remove str/blank? (str/split-lines (slurp (str root "/tests/codex-workspace/task-board-runner-cases.txt"))))))

(defn pmap-jobs
  "Run f over items with n workers, each worker owning one sandbox index."
  [n items f]
  (let [q (atom (map-indexed vector items))
        take! (fn [] (let [[old _] (swap-vals! q rest)] (first old)))
        out (atom {})
        workers (doall (for [w (range n)]
                         (future
                           (loop []
                             (when-let [[i item] (take!)]
                               (swap! out assoc i (f w item))
                               (recur))))))]
    (run! deref workers)
    (mapv @out (range (count items)))))

(defn coverage!
  "Which runner test cases reach which target function, and how long each case takes."
  [config group out jobs]
  (let [file (:file group)
        src (slurp (str root "/" file))
        instrumented (instrument src (:fns group))
        cases (runner-cases)
        sandboxes (vec (for [w (range jobs)] (make-sandbox! config (fs/path out "sandbox" (str "cov-" w)))))]
    (doseq [s sandboxes] (spit (str s "/" file) instrumented))
    (println (str "coverage: " (count cases) " runner cases, " jobs " job(s)"))
    (let [results (pmap-jobs jobs cases
                             (fn [w c]
                               (let [cov (str (sandboxes w) "/.tmp/cov-" c)
                                     {:keys [cmd env]} (resolve-cmd (case-cmd c))
                                     r (run-cmd (sandboxes w) cmd (assoc env "TB_MUTATION_COVERAGE" cov) (* 20 60 1000))
                                     hit (if (fs/exists? cov) (set (str/split-lines (slurp cov))) #{})]
                                 (println (str "  " c " " (name (:status r)) " " (quot (:ms r) 1000) "s hits=" (count hit)))
                                 {:case c :status (:status r) :ms (:ms r) :hits hit})))]
      {:file file :src-sha (str (hash src)) :cases results})))

(defn baseline!
  "The unmutated tests have to pass in the sandbox; a failing one cannot judge a mutant."
  [sandbox cmds]
  (vec (for [cmd cmds
             :let [{c :cmd env :env} (resolve-cmd cmd)
                   r (run-cmd sandbox c env (* 20 60 1000))]]
         (assoc (dissoc r :out) :cmd cmd))))

(defn run-mutant!
  "Run the plan in order and stop at the first failing command (the mutant is killed)."
  [sandbox file src mutant plan]
  (spit (str sandbox "/" file) (apply-mutant src mutant))
  (let [result (loop [[{:keys [cmd ms]} & more] plan ran 0 total 0]
                 (if-not cmd
                   {:status :survived :ran ran :ms total}
                   (let [{c :cmd env :env} (resolve-cmd cmd)
                         r (run-cmd sandbox c env (+ 30000 (* 3 ms)))]
                     (case (:status r)
                       :pass (recur more (inc ran) (+ total (:ms r)))
                       :fail {:status :killed :by cmd :ran (inc ran) :ms (+ total (:ms r))
                              :tail (vec (take-last 4 (str/split-lines (or (:out r) ""))))}
                       :timeout {:status :timeout :by cmd :ran (inc ran) :ms (+ total (:ms r))}))))]
    (spit (str sandbox "/" file) src)
    (merge mutant result)))

(defn arg [args flag] (second (drop-while #(not= flag %) args)))

(defn summary-md [group results cov-note elapsed-ms]
  (let [by (group-by :status results)
        n (count results)
        killed (+ (count (:killed by)) (count (:timeout by)))
        judged (- n (count (:equivalent by)))
        score (if (pos? judged) (/ (Math/round (* 1000.0 (/ killed judged))) 10.0) 0.0)]
    (str "## " (:name group) "\n\n"
         "- file: `" (:file group) "`\n"
         "- mutants: " n ", killed: " (count (:killed by)) ", timeout: " (count (:timeout by))
         ", survived: " (count (:survived by)) ", no test reached: " (count (:uncovered by))
         ", equivalent (accepted): " (count (:equivalent by))
         ", score: " score "% (equivalent mutants excluded)\n"
         "- elapsed: " (quot elapsed-ms 1000) "s" cov-note "\n\n"
         (when-let [s (seq (concat (:survived by) (:uncovered by)))]
           (str "| fn | line | status | mutation | original |\n|---|---|---|---|---|\n"
                (str/join (for [m (sort-by (juxt :fn :line) s)]
                            (str "| " (:fn m) " | " (:line m) " | " (name (:status m)) " | `"
                                 (str/replace (:desc m) "|" "\\|") "` | `"
                                 (str/replace (subs (:original m) 0 (min 60 (count (:original m)))) "|" "\\|") "` |\n")))))
         (when-let [s (seq (:equivalent by))]
           (str "\nEquivalent (accepted in task-board-mutation-targets.edn):\n\n"
                (str/join (for [m (sort-by (juxt :fn :line) s)]
                            (str "- " (:fn m) ":" (:line m) " `" (:desc m) "`: " (:reason m) "\n")))))
         "\n")))

(defn run-group! [config group {:keys [out jobs fn-filter max-cases]}]
  (let [file (:file group)
        src (slurp (str root "/" file))
        fns (cond->> (:fns group) fn-filter (filter #(= (str %) fn-filter)))
        mutants (vec (mapcat #(mutants-for src %) fns))
        started (System/currentTimeMillis)
        cov (when (:runner-cases group)
              (let [cov-file (str out "/coverage-" (:name group) ".edn")
                    cached (when (fs/exists? cov-file) (edn/read-string (slurp cov-file)))]
                (if (and cached (= (:src-sha cached) (str (hash src))))
                  cached
                  (let [c (coverage! config group out jobs)] (spit cov-file (pr-str c)) c))))
        sandboxes (vec (for [w (range jobs)] (make-sandbox! config (fs/path out "sandbox" (str "mut-" w)))))
        base (baseline! (sandboxes 0) (:tests group))
        _ (when-let [bad (seq (remove #(= :pass (:status %)) base))]
            (throw (ex-info "baseline tests failed in the sandbox" {:failed (map :cmd bad)})))
        case-plan (fn [fname]
                    (->> (:cases cov)
                         (filter #(and (= :pass (:status %)) (contains? (:hits %) fname)))
                         (sort-by :ms)
                         (#(if max-cases (take max-cases %) %))
                         (map (fn [c] {:cmd (case-cmd (:case c)) :ms (:ms c)}))))
        plans (into {} (for [f fns] [(str f) (vec (concat (map #(select-keys % [:cmd :ms]) base) (case-plan (str f))))]))]
    (println (str "group " (:name group) ": " (count mutants) " mutants, " jobs " job(s)"))
    ;; An accepted entry that no longer names a mutant is stale: the code changed under it.
    (doseq [e (:equivalent group)
            :when (and (or (nil? fn-filter) (= fn-filter (str (:fn e))))
                       (not-any? #(and (= (str (:fn e)) (:fn %)) (= (:desc e) (:desc %))) mutants))]
      (println (str "WARNING stale :equivalent entry (no such mutant): " (:fn e) " " (:desc e))))
    (doseq [f fns] (println (str "  " f ": " (count (filter #(= (str f) (:fn %)) mutants)) " mutants, "
                                 (count (plans (str f))) " test command(s)")))
    (let [results (pmap-jobs jobs mutants
                             (fn [w m]
                               (let [r (run-mutant! (sandboxes w) file src m (plans (:fn m)))
                                     r (if (and (= :survived (:status r))
                                                (not (some #(= (:fn m) %) (mapcat :hits (:cases cov))))
                                                (:runner-cases group))
                                         (assoc r :status :uncovered) r)
                                     accepted (first (filter #(and (= (:fn m) (str (:fn %))) (= (:desc m) (:desc %))) (:equivalent group)))
                                     r (if (and accepted (#{:survived :uncovered} (:status r)))
                                         (assoc r :status :equivalent :reason (:reason accepted)) r)]
                                 (println (str "  " (name (:status r)) " " (:fn r) ":" (:line r) " " (:desc r)
                                               (when (:by r) (str " by " (pr-str (:by r))))))
                                 r)))
          elapsed (- (System/currentTimeMillis) started)
          cov-note (if cov (str " (runner cases with coverage: " (count (filter #(seq (:hits %)) (:cases cov))) ")") "")]
      (spit (str out "/result-" (:name group) ".edn") (pr-str {:group (:name group) :results results :baseline base}))
      (summary-md group results cov-note elapsed))))

;; ---------------------------------------------------------------------------
;; Self test: the operators and the copy never touch the checkout.

(defn self-test []
  (let [src "(ns x)\n(defn f \"doc\" [a b]\n  (cond (= a 1) :one\n        (> b 2) :big\n        :else (when-not (contains? #{\"P0\" \"P1\"} a) (re-find #\"(?i)^X:\\s*(y)$\" b))))\n(defn g [] (inc 0))\n(defn h [a] (not (= a 1)))\n"
        ms (mutants-for src 'f)
        descs (set (map :desc ms))
        expect #{"= -> not=" "1 -> 2" "1 -> 0" "> -> >=" "> -> <" "2 -> 3" "2 -> 0" "when-not -> when"
                 "contains? -> (complement contains?)" "drop set element \"P0\"" "drop set element \"P1\""
                 "drop cond clause 1 \"(= a 1)\"" "drop cond clause 2 \"(> b 2)\""}]
    (assert (every? descs expect) (str "missing operators: " (remove descs expect)))
    (assert (not (some #(= "doc" (:original %)) ms)) "docstrings are not mutated")
    (doseq [m ms]
      (let [out (apply-mutant src m)]
        (assert (not= src out) (str "mutant did not change the source: " m))
        (assert (str/includes? out "(defn g [] (inc 0))") "a mutant keeps the rest of the file")
        (load-string (str "(ns tbm-self-" (gensym) ")" (str/replace out "(ns x)" "")))))
    (let [inst (instrument src ['f 'g])]
      (assert (str/includes? inst "TB_MUTATION_COVERAGE"))
      (assert (= 2 (count (re-seq #"TB_MUTATION_COVERAGE" inst)))))
    (assert (= #{"inc -> dec" "0 -> 1" "0 -> -1"} (set (map :desc (mutants-for src 'g)))))
    (assert (str/includes? (apply-mutant src (first (filter #(= "(not x) -> x" (:desc %)) (mutants-for src 'h)))) "(defn h [a] (= a 1))"))
    (println (str "self-test ok: " (count ms) " mutants of f"))))

(defn -main [& args]
  (let [config (edn/read-string (slurp (str root "/tests/codex-workspace/task-board-mutation-targets.edn")))
        group-filter (arg args "--group")
        groups (cond->> (:groups config)
                 group-filter (filter #(= group-filter (:name %)))
                 (some #{"--direct-only"} args) (map #(dissoc % :runner-cases)))
        out (str (fs/absolutize (or (arg args "--out") (str (System/getProperty "java.io.tmpdir") "/task-board-mutation"))))
        jobs (parse-long (or (arg args "--jobs") "1"))]
    (cond
      (some #{"--self-test"} args) (self-test)
      (some #{"--list"} args)
      (doseq [g groups]
        (let [src (slurp (str root "/" (:file g)))]
          (println (str (:name g) " (" (:file g) ")"))
          (doseq [f (:fns g)]
            (let [ms (mutants-for src f)]
              (println (str "  " f " " (count ms)))
              (when (some #{"--verbose"} args)
                (doseq [m ms] (println (str "    " (:line m) " " (:desc m)))))))))
      :else
      (do
        (fs/create-dirs out)
        (when (str/starts-with? out (str root "/"))
          (throw (ex-info "--out must be outside the checkout" {:out out})))
        (let [md (str/join (for [g groups] (run-group! config g {:out out :jobs jobs :fn-filter (arg args "--fn")
                                                                           :max-cases (some-> (arg args "--max-cases") parse-long)})))]
          (spit (str out "/summary.md") md)
          (println md)
          (println (str "report: " out "/summary.md")))))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
