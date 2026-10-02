(ns autonomy-intent
  "Pure execution-intent evaluation for Task Board autonomy v2 (BOXP-201 I2).

  A v2 start is decided from the owner-controlled control original, never from
  the lane, the assignee or any other agent-writable projection. These functions
  perform no I/O and start nothing: the runner only uses them for shadow
  comparison while v2 stays off. Results carry a fixed-shape diagnostic and never
  include requirements, ticket text, credentials or exception text."
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; Sibling .bb scripts are loaded explicitly; they are not classpath libraries.
(when-not (find-ns 'autonomy-policy)
  (load-file (str (fs/path (fs/parent *file*) "autonomy_policy.bb"))))
(in-ns 'autonomy-intent)
(alias 'policy 'autonomy-policy)

(def ^:private diagnostic-codes
  {:ok "ok"
   :legacy "legacy"
   :legacy-route-retired "legacy-route-retired"
   :no-legacy-action "no-legacy-action"
   :unsupported-version "unsupported-version"
   :not-canary "not-canary"
   :control-unavailable "control-unavailable"
   :control-mismatch "control-mismatch"
   :stale-generation "stale-generation"
   :intent-stopped "intent-stopped"
   :projection-mismatch "projection-mismatch"
   :objective-mismatch "objective-mismatch"
   :unsupported-route "unsupported-route"
   :budget-exhausted "budget-exhausted"
   :lane-terminal "lane-terminal"
   :retry-contract-required "retry-contract-required"
   :revision-changed "revision-changed"
   :lane-changed "lane-changed"
   :decision-invalid "decision-invalid"})

(defn- diagnostic [category]
  (let [category (if (contains? diagnostic-codes category) category :control-unavailable)]
    {:category category :code (get diagnostic-codes category)}))

(defn- no-start [mode category]
  {:mode mode :start? false :action nil :diagnostic (diagnostic category)})

;; --- routes -------------------------------------------------------------------

;; v2 names the Claude model explicitly. The retired `fable` route and the other
;; legacy Claude assignees are not v2 routes, and no environment override or
;; Codex profile can change the model selected here.
(def ^:private claude-route->model {"claude-fable" "claude-fable-5-1"})

(defn launch-spec
  "How a v2 agent_route is launched, or nil when the route cannot be started.
  The control original must already be valid; this only maps a registry route to
  a CLI and never falls back to another route."
  [route]
  (cond
    (contains? claude-route->model route)
    (let [model (get claude-route->model route)]
      {:cli :claude
       :route route
       :model model
       :args ["--model" model]
       :helper "~/.claude/skills/obsidian-task-board/bin/task-board.bb"
       :notes-source route})

    (and (string? route) (some? (re-matches #"codex(?:-[a-z]+){0,2}" route)))
    {:cli :codex
     :route route
     :helper "~/.codex/skills/obsidian-task-board/bin/task-board.bb"
     :notes-source route}

    :else nil))

;; --- ticket projections ---------------------------------------------------------

(defn- fm-get [frontmatter key]
  (when (map? frontmatter)
    (let [value (or (get frontmatter (keyword key)) (get frontmatter key))]
      (when (and (string? value) (not (str/blank? value))) value))))

(def ^:private v2-projection-keys ["autonomy_version" "execution_intent" "control_revision"])

(defn- v2-claimed? [frontmatter]
  (boolean (some #(fm-get frontmatter %) v2-projection-keys)))

(defn- section-lines [lines title]
  (let [heading (str "## " title)
        after (rest (drop-while #(not= heading (str/trimr %)) lines))]
    (when (some #(= heading (str/trimr %)) lines)
      (->> after
           (take-while #(not (str/starts-with? % "## ")))
           ;; Ticking an acceptance checkbox is progress, not a new requirement.
           (map #(str/replace (str/trimr %) #"^(\s*-\s+)\[[xX]\]" "$1[ ]"))
           (drop-while str/blank?)
           reverse
           (drop-while str/blank?)
           reverse))))

(defn requirements-text
  "The normalized requirement part of a ticket: Summary and Acceptance Criteria.
  Notes, lane, assignee and checkbox state are not part of the objective. Returns
  nil when either section is missing or empty."
  [ticket-text]
  (when (string? ticket-text)
    (let [lines (str/split-lines ticket-text)
          summary (section-lines lines "Summary")
          criteria (section-lines lines "Acceptance Criteria")]
      (when (and (seq summary) (seq criteria))
        (str "## Summary\n" (str/join "\n" summary)
             "\n\n## Acceptance Criteria\n" (str/join "\n" criteria) "\n")))))

(defn- objective-matches? [control ticket-text]
  (let [requirements (requirements-text ticket-text)]
    (and (string? requirements)
         (= requirements (get-in control [:objective :requirements]))
         (= (policy/sha256 requirements) (get-in control [:objective :requirements_sha256])))))

(defn- projection-matches? [control frontmatter]
  (and (= "2" (fm-get frontmatter "autonomy_version"))
       (= (:intent control) (fm-get frontmatter "execution_intent"))
       (= (str (:revision control)) (fm-get frontmatter "control_revision"))))

;; --- candidate evaluation -------------------------------------------------------

(def ^:private status->action
  {"backlog" :groom
   "ready" :implement
   "in-progress" :implement
   "review" :review-fix})

(defn- non-negative-int? [value]
  (and (integer? value) (<= 0 value)))

(defn- evaluate-legacy [{:keys [frontmatter legacy-action]}]
  (cond
    (nil? legacy-action) (no-start :legacy-v1 :no-legacy-action)
    ;; `fable` is retired for new starts. With v2 off this is a shadow verdict
    ;; only; the legacy runner keeps its own candidate rule.
    (= "fable" (fm-get frontmatter "assignee")) (no-start :legacy-v1 :legacy-route-retired)
    :else {:mode :legacy-v1 :start? true :action legacy-action :diagnostic (diagnostic :legacy)}))

(defn- evaluate-v2
  [{:keys [card frontmatter ticket-text control-result canary-tickets policy-context]}]
  (let [{:keys [ticket-id status]} card
        control (:control control-result)
        consumed (:consumed control-result)
        fail (partial no-start :v2)]
    (cond
      (not= "2" (fm-get frontmatter "autonomy_version")) (fail :unsupported-version)
      (not (contains? #{"backlog" "ready" "in-progress" "review" "blocked"} status)) (fail :lane-terminal)
      (not (and (set? canary-tickets) (contains? canary-tickets ticket-id))) (fail :not-canary)
      (not (and (map? control-result) (true? (:ok? control-result)))) (fail :control-unavailable)

      (not (and (map? control)
                (= ticket-id (:ticket control))
                (= (:revision control) (:revision control-result))
                (true? (:valid? (policy/validate-control control policy-context)))
                (map? consumed)
                (non-negative-int? (:steps consumed))
                (non-negative-int? (:wall_minutes consumed))))
      (fail :control-mismatch)

      (not (and (pos-int? (:generation control-result))
                (= (:generation control-result) (:writer_generation control))))
      (fail :stale-generation)

      ;; An explicit stop wins before anything else is compared.
      (not= "run" (:intent control)) (fail :intent-stopped)
      (not (projection-matches? control frontmatter)) (fail :projection-mismatch)
      (not (objective-matches? control ticket-text)) (fail :objective-mismatch)
      (nil? (launch-spec (:agent_route control))) (fail :unsupported-route)

      (or (>= (:steps consumed) (get-in control [:budget :max_steps]))
          (>= (:wall_minutes consumed) (get-in control [:budget :max_wall_minutes])))
      (fail :budget-exhausted)

      ;; Blocked resumes only through a retry contract, which arrives with I4.
      (= "blocked" status) (fail :retry-contract-required)

      :else
      {:mode :v2
       :start? true
       :action (get status->action status)
       :diagnostic (diagnostic :ok)
       :launch (launch-spec (:agent_route control))
       :snapshot {:ticket ticket-id
                  :revision (:revision control)
                  :generation (:generation control-result)
                  :route (:agent_route control)
                  :requirements_sha256 (get-in control [:objective :requirements_sha256])
                  :scope-digest (policy/scope-digest (:scope control))}})))

(defn evaluate
  "Decide whether one Board card may start.

  input keys:
    :card            {:ticket-id :status} from the Board, the lane source of truth
    :frontmatter     ticket frontmatter (keyword or string keys); a projection only
    :ticket-text     full ticket text, compared with the objective snapshot
    :legacy-action   what the legacy runner would do for this card, or nil
    :control-result  autonomy-control/read-control result for the ticket
    :canary-tickets  set of ticket IDs the owner selected, from owner-side config
    :policy-context  {:now :allowed-repos :allowed-paths}, owner-side bounds

  A ticket without any v2 projection key is legacy-v1. Any v2 claim that cannot
  be fully verified against the control original never falls back to the legacy
  rule and does not start."
  [input]
  (try
    (if (v2-claimed? (:frontmatter input))
      (evaluate-v2 input)
      (evaluate-legacy input))
    (catch Exception _
      (no-start (if (v2-claimed? (:frontmatter input)) :v2 :legacy-v1) :control-unavailable))))

(defn confirm-start
  "Re-check a candidate after its ticket lock was taken. fresh is `evaluate` run
  again on state read under the lock. The start holds only when nothing the
  candidate snapshot was based on has moved."
  [candidate fresh]
  (cond
    (not (and (true? (:start? candidate)) (= :v2 (:mode candidate)))) (no-start :v2 :revision-changed)
    (not (true? (:start? fresh))) (no-start :v2 (get-in fresh [:diagnostic :category]))
    (not= (select-keys candidate [:mode :action :snapshot])
          (select-keys fresh [:mode :action :snapshot])) (no-start :v2 :revision-changed)
    :else fresh))

(defn finish-projection
  "Whether a finished run may project its result onto lane and ticket state.
  snapshot is the :snapshot the run started from; control-result is the control
  original and current-status the Board lane status, both read at finish. A newer
  owner stop, any revision change or a card moved out of In Progress wins: the
  result stays in the run artifacts and is not projected."
  [snapshot control-result current-status]
  (let [control (:control control-result)
        hold (fn [category] {:project? false :diagnostic (diagnostic category)})]
    (cond
      (not (and (map? snapshot) (map? control-result) (true? (:ok? control-result))
                (map? control) (= (:ticket snapshot) (:ticket control))))
      (hold :control-unavailable)

      (not= (:generation snapshot) (:generation control-result)) (hold :stale-generation)
      (not= "run" (:intent control)) (hold :intent-stopped)
      (not= (:revision snapshot) (:revision control)) (hold :revision-changed)
      (not= "in-progress" current-status) (hold :lane-changed)
      :else {:project? true :diagnostic (diagnostic :ok)})))

(defn decision-current?
  "A decision packet stays usable only for the control revision, scope and
  artifact head it was issued for. artifact-head is the head being acted on now;
  without it nothing can be confirmed. This is not an approval check (I6)."
  [decision {:keys [control artifact-head policy-context]}]
  (let [verdict (when (and (string? artifact-head) (map? policy-context))
                  (policy/validate-decision
                   decision
                   (assoc policy-context :control control :artifact-head artifact-head)))
        status (when (map? decision) (or (:status decision) (get decision "status")))]
    (if (and (true? (:valid? verdict)) (contains? #{"pending" "resolved"} status))
      {:current? true :diagnostic (diagnostic :ok)}
      {:current? false :diagnostic (diagnostic :decision-invalid)})))

;; --- shadow comparison ------------------------------------------------------------

(defn shadow-entry
  "Compare the legacy candidate rule with the v2 verdict for one card. The entry
  holds registry values only, so it is safe to persist next to run state."
  [{:keys [card legacy-action] :as input}]
  (let [verdict (evaluate input)
        legacy-start? (some? legacy-action)]
    {:ticket (:ticket-id card)
     :status (:status card)
     :mode (:mode verdict)
     :legacy-action legacy-action
     :start? (:start? verdict)
     :action (:action verdict)
     :diagnostic (get-in verdict [:diagnostic :code])
     :differs? (or (not= legacy-start? (:start? verdict))
                   (and legacy-start? (not= legacy-action (:action verdict))))}))

(defn shadow-summary
  "Aggregate shadow entries into counts for the owner's comparison."
  [entries]
  {:schema_version 1
   :cards (count entries)
   :legacy-starts (count (filter :legacy-action entries))
   :shadow-starts (count (filter :start? entries))
   :differing (count (filter :differs? entries))
   :by-mode (frequencies (map :mode entries))
   :by-diagnostic (frequencies (map :diagnostic entries))
   :entries (vec (sort-by :ticket entries))})
