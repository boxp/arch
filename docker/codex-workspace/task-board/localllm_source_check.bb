#!/usr/bin/env bb
;; localllm_source_check.bb — verify, from a localllm docs run's audit file
;; *metadata only*, that a `docs-mode: create` run really read the intended
;; canon (BOXP-287).
;;
;; The owner's correction after BOXP-282: "searched the whole vault" and
;; "18/18 on the synthetic fixture" are not the goal; the goal is a note built
;; from the real setting folder. This check lets the developer (who must not
;; read the private setting text) confirm from paths and counts alone that:
;;
;;   * every note the model read (`:research :read-paths`) and every cited
;;     source (`:sources`) lies under an allowed prefix (the real setting
;;     folder) and under no forbidden prefix (synthetic fixtures, pilot,
;;     proposals, evidence);
;;   * every required note (the world / monster rules the request named) is in
;;     the read list — a `search` hit alone does not count;
;;   * at least one cited source exists and every cited source was read;
;;   * the audit is a `docs-mode: create` run that reached :review (a note was
;;     created / replaced) — a transcribe / propose audit never passes.
;;
;; It prints only vault-relative paths, counts and PASS / FAIL lines; it never
;; prints `:summary`, evidence text, the model's name / body or any heading.
;;
;; Usage:
;;   localllm_source_check.bb <localllm-audit.edn> \
;;     --allow <prefix>[,<prefix>...] [--forbid <prefix>[,...]] \
;;     [--require <path>[,<path>...]] [--json]
;;
;; Exit 0 = PASS, 1 = FAIL, 2 = usage / unreadable audit.

(require '[clojure.edn :as edn]
         '[clojure.string :as str]
         '[cheshire.core :as json])

(def default-forbid
  ["Projects/task-board-localllm-docs/refs"
   "Projects/task-board-localllm-docs/pilot"
   "Projects/task-board-localllm-docs/proposals"
   "Projects/task-board-localllm-docs/evidence"])

(defn- split-list [s]
  (->> (str/split (or s "") #"[,\n]") (map str/trim) (remove str/blank?) vec))

(defn- parse-args [args]
  (loop [xs args opts {:forbid default-forbid}]
    (if (empty? xs)
      opts
      (let [[a b & more] xs]
        (case a
          "--allow" (recur more (assoc opts :allow (split-list b)))
          "--forbid" (recur more (assoc opts :forbid (split-list b)))
          "--require" (recur more (assoc opts :require (split-list b)))
          "--json" (recur (rest xs) (assoc opts :json true))
          (if (and (not (str/starts-with? a "--")) (nil? (:audit opts)))
            (recur (rest xs) (assoc opts :audit a))
            (recur (rest xs) (update opts :unknown (fnil conj []) a))))))))

(defn normalize
  "Vault-relative path without a leading `./`, `/` or trailing `.md`, so a
  required note may be given with or without the extension."
  [p]
  (-> (str p) str/trim
      (str/replace #"^\./" "")
      (str/replace #"^/+" "")
      (str/replace #"/+$" "")
      (str/replace #"\.md$" "")))

(defn under?
  "`rel` equals `prefix` or lies inside the folder `prefix`."
  [rel prefix]
  (let [r (normalize rel) p (normalize prefix)]
    (or (= r p) (str/starts-with? r (str p "/")))))

(defn- allowed? [rel allow] (boolean (some #(under? rel %) allow)))
(defn- forbidden? [rel forbid] (boolean (some #(under? rel %) forbid)))

(defn check
  "Pure check over the audit map. Returns {:pass? bool :checks [...] :facts {...}}."
  [audit {:keys [allow forbid require]}]
  (let [research (:research audit)
        read-paths (vec (distinct (map str (or (:read-paths research) []))))
        sources (vec (distinct (map str (or (:sources audit) []))))
        read-set (set (map normalize read-paths))
        required (vec (or require []))
        missing-required (vec (remove #(contains? read-set (normalize %)) required))
        reads-outside (vec (remove #(allowed? % allow) read-paths))
        reads-forbidden (vec (filter #(forbidden? % forbid) read-paths))
        sources-outside (vec (remove #(allowed? % allow) sources))
        sources-forbidden (vec (filter #(forbidden? % forbid) sources))
        sources-unread (vec (remove #(contains? read-set (normalize %)) sources))
        status (:status audit)
        checks [{:id :mode-create :pass? (= "create" (str (:mode audit)))
                 :detail (str "mode=" (pr-str (:mode audit)))}
                {:id :status-review :pass? (= :review (keyword (name (or status "none"))))
                 :detail (str "status=" (pr-str status))}
                {:id :sources-present :pass? (pos? (count sources))
                 :detail (str "sources=" (count sources))}
                {:id :reads-allowed :pass? (and (pos? (count read-paths)) (empty? reads-outside))
                 :detail (str "read-paths=" (count read-paths) " outside-allow=" (count reads-outside)
                              (when (seq reads-outside) (str " " (pr-str reads-outside))))}
                {:id :reads-not-forbidden :pass? (empty? reads-forbidden)
                 :detail (str "forbidden-read=" (count reads-forbidden)
                              (when (seq reads-forbidden) (str " " (pr-str reads-forbidden))))}
                {:id :sources-allowed :pass? (and (empty? sources-outside) (empty? sources-forbidden))
                 :detail (str "outside-allow=" (count sources-outside) " forbidden=" (count sources-forbidden)
                              (when (seq (concat sources-outside sources-forbidden))
                                (str " " (pr-str (vec (concat sources-outside sources-forbidden))))))}
                {:id :sources-were-read :pass? (empty? sources-unread)
                 :detail (str "cited-but-unread=" (count sources-unread)
                              (when (seq sources-unread) (str " " (pr-str sources-unread))))}
                {:id :required-read :pass? (empty? missing-required)
                 :detail (str "required=" (count required) " missing=" (count missing-required)
                              (when (seq missing-required) (str " " (pr-str missing-required))))}]]
    {:pass? (every? :pass? checks)
     :checks checks
     :facts {:ticket-id (:ticket-id audit)
             :run-id (:run-id audit)
             :status status
             :mode (:mode audit)
             :docs-kind (:docs-kind audit)
             :docs-sources (:docs-sources audit)
             :corpus-notes (:corpus-notes research)
             :corpus-chars (:corpus-chars research)
             :corpus-excluded (:corpus-excluded research)
             :corpus-redacted-lines (:corpus-redacted-lines research)
             :rounds (:rounds research)
             :searches (:searches research)
             :lists (:lists research)
             :reads (:reads research)
             :stop (:stop research)
             :read-paths read-paths
             :search-hit-paths-count (count (or (:search-hit-paths research) []))
             :sources sources
             :created-paths (let [c (:create audit)]
                              (cond (map? c) (vec (remove nil? [(:path c) (:rel c) (:note c)]))
                                    (sequential? c) (vec (keep #(when (map? %) (or (:path %) (:rel %))) c))
                                    :else []))
             :llm-elapsed-ms (:llm-elapsed-ms audit)}}))

(defn- print-text [{:keys [pass? checks facts]}]
  (println (str "ticket=" (:ticket-id facts) " run=" (:run-id facts) " status=" (pr-str (:status facts))
                " mode=" (:mode facts) " kind=" (:docs-kind facts)))
  (println (str "docs-sources=" (pr-str (:docs-sources facts))))
  (println (str "corpus notes=" (:corpus-notes facts) " chars=" (:corpus-chars facts)
                " excluded=" (:corpus-excluded facts) " redacted-lines=" (:corpus-redacted-lines facts)))
  (println (str "research rounds=" (:rounds facts) " searches=" (:searches facts) " lists=" (:lists facts)
                " reads=" (:reads facts) " stop=" (pr-str (:stop facts))
                " search-hit-paths=" (:search-hit-paths-count facts) " llm-ms=" (:llm-elapsed-ms facts)))
  (println (str "read-paths (" (count (:read-paths facts)) "):"))
  (doseq [p (:read-paths facts)] (println (str "  " p)))
  (println (str "sources (" (count (:sources facts)) "):"))
  (doseq [p (:sources facts)] (println (str "  " p)))
  (when (seq (:created-paths facts))
    (println (str "created: " (str/join ", " (:created-paths facts)))))
  (doseq [{:keys [id pass? detail]} checks]
    (println (str (if pass? "PASS" "FAIL") " " (name id) ": " detail)))
  (println (if pass? "RESULT: PASS" "RESULT: FAIL")))

(defn -main [& args]
  (let [opts (parse-args args)]
    (cond
      (or (nil? (:audit opts)) (empty? (:allow opts)) (seq (:unknown opts)))
      (do (binding [*out* *err*]
            (println "usage: localllm_source_check.bb <localllm-audit.edn> --allow <prefix>[,..] [--forbid <prefix>[,..]] [--require <path>[,..]] [--json]")
            (when (seq (:unknown opts)) (println (str "unknown args: " (pr-str (:unknown opts))))))
          (System/exit 2))
      :else
      (let [audit (try (edn/read-string {:default (fn [_ v] v)} (slurp (:audit opts)))
                       (catch Exception e
                         (binding [*out* *err*] (println (str "cannot read audit: " (.getMessage e))))
                         (System/exit 2)))
            result (check audit opts)]
        (if (:json opts)
          (println (json/generate-string (-> result
                                             (update :checks (fn [cs] (mapv #(update % :id name) cs)))
                                             (update :facts update :status #(some-> % name))
                                             (update :facts update :stop #(if (keyword? %) (name %) %)))))
          (print-text result))
        (System/exit (if (:pass? result) 0 1))))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
