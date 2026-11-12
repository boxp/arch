#!/usr/bin/env bb

;; Task Board -> Hermes event outbox and dispatcher (BOXP-270).
;;
;; The runner records a minimal event after a ticket transition has been
;; committed (lane, frontmatter, Notes). Events are persisted as EDN files under
;; `<root>/outbox/pending/` and delivered to the Hermes webhook platform by the
;; dispatcher loop (`task_board_events.bb loop`), which runs as a separate
;; container that holds the HMAC secret. The runner process itself never needs
;; the secret.
;;
;; Lifecycle of one event file:
;;   pending  (:status :pending)   -> POST accepted by Hermes (2xx)
;;   pending  (:status :accepted)  -> handled marker and, for a sent report, the gate receipt
;;   pending  (:status :notify-pending) -> morning digest -> done/
;;   done/                          (processing and delivery completed)
;;   unhandled/                     (accepted, redelivered, never marked handled)
;;   failed/                        (transport attempts exhausted)
;;
;; Transport acceptance (HTTP 2xx) and processing completion (Kohako appending a
;; `handled event=<id>` Notes line) are tracked separately.

(ns task-board-events
  (:require [babashka.fs :as fs]
            [babashka.http-client :as http]
            [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.string :as str])
  (:import [java.time Instant OffsetDateTime ZoneId ZonedDateTime]
           [java.security MessageDigest]
           [javax.crypto Mac]
           [javax.crypto.spec SecretKeySpec]))

(def lane->status
  {"Backlog" "backlog"
   "Ready" "ready"
   "In Progress" "in-progress"
   "Blocked" "blocked"
   "Done" "done"})

;; BOXP-395: Review is retired. A card under a leftover heading stays readable so
;; the lane snapshot keeps knowing where it came from (see `detect-lane-changes!`).
(def legacy-lane->status (assoc lane->status "Review" "review"))

;; Transitions that wake Kohako. Start / heartbeat / minor progress never do.
;; A pending "review" event from before the retirement is still delivered: the
;; delivery path reads the outbox and does not consult this set.
(def trigger-statuses #{"blocked" "done"})

(def schema-version 1)

(def log-mutex (Object.))

(defn log! [message]
  (locking log-mutex
    (println (str "[events] " message))))

(defn env [k default]
  (let [v (System/getenv k)]
    (if (str/blank? v) default v)))

(defn env-long [k default]
  (Long/parseLong (env k default)))

(defn root [] (env "CODEX_TASK_BOARD_ROOT" "/home/boxp/.codex-task-board"))
(defn vault [] (env "CODEX_TASK_BOARD_VAULT" "/home/boxp/Documents/obsidian-headless/BOXP"))
(defn outbox-dir [] (str (fs/path (root) "outbox")))
(defn pending-dir [] (str (fs/path (outbox-dir) "pending")))
(defn done-dir [] (str (fs/path (outbox-dir) "done")))
(defn failed-dir [] (str (fs/path (outbox-dir) "failed")))
(defn unhandled-dir [] (str (fs/path (outbox-dir) "unhandled")))
(defn snapshot-path [] (str (fs/path (outbox-dir) "board-lanes.edn")))

(defn ensure-dirs! []
  (doseq [d [(pending-dir) (done-dir) (failed-dir) (unhandled-dir)]]
    (fs/create-dirs d)))

(defn now ^Instant []
  (if-let [override (System/getenv "CODEX_TASK_BOARD_EVENT_CLOCK_OVERRIDE")]
    (Instant/parse override)
    (Instant/now)))

(defn now-str [] (str (now)))

(defn compact-ts []
  (-> (now) str (str/replace #"[-:]" "") (str/replace #"\.\d+" "")))

(defn short-uuid []
  (subs (str (java.util.UUID/randomUUID)) 0 8))

(defn seconds-since [instant-str]
  (if (str/blank? instant-str)
    Long/MAX_VALUE
    (- (.getEpochSecond (now)) (.getEpochSecond (Instant/parse instant-str)))))

;; ---------------------------------------------------------------------------
;; Ticket / Board reading (read-only)
;; ---------------------------------------------------------------------------

(defn ticket-path [ticket-id]
  (str (fs/path (vault) "Tickets" (str ticket-id ".md"))))

(defn board-path []
  (str (fs/path (vault) "Boards" "Task Board.md")))

(defn sha256-hex [^String s]
  (let [md (MessageDigest/getInstance "SHA-256")]
    (->> (.digest md (.getBytes s "UTF-8"))
         (map #(format "%02x" %))
         (apply str))))

(defn ticket-revision
  "Short content hash of the ticket file at event time. Kohako compares it with
  the current file to detect that a newer state superseded the event."
  [ticket-id]
  (let [path (ticket-path ticket-id)]
    (when (fs/exists? path)
      (subs (sha256-hex (slurp path)) 0 12))))

(defn parse-board-lanes
  "Map of ticket-id -> status from the Task Board. The first card wins when a
  broken board lists the same ticket twice, mirroring task_board_monitor.clj."
  [lines]
  (loop [lines lines
         lane nil
         acc {}]
    (if-let [line (first lines)]
      (let [heading (when-let [[_ h] (re-matches #"^##\s+(.+?)\s*$" line)] h)
            card-id (when-let [[_ id] (re-find #"\[\[Tickets/(BOXP-\d+)\|" line)] id)]
        (cond
          heading (recur (rest lines) (legacy-lane->status heading) acc)
          (and card-id lane (not (contains? acc card-id)))
          (recur (rest lines) lane (assoc acc card-id lane))
          :else (recur (rest lines) lane acc)))
      acc)))

(defn board-lanes []
  (let [path (board-path)]
    (if (fs/exists? path)
      (parse-board-lanes (str/split-lines (slurp path)))
      {})))

;; ---------------------------------------------------------------------------
;; Outbox files
;; ---------------------------------------------------------------------------

(defn read-event [path]
  (try
    (edn/read-string (slurp (str path)))
    (catch Exception e
      (log! (str "unreadable event file " path ": " (.getMessage e)))
      nil)))

(defn write-event!
  "Atomic write: temp file in the same directory, then move."
  [dir event]
  (fs/create-dirs dir)
  (let [target (fs/path dir (str (:event-id event) ".edn"))
        tmp (fs/path dir (str (:event-id event) ".edn.tmp"))]
    (spit (str tmp) (pr-str event))
    (fs/move tmp target {:replace-existing true :atomic-move true})
    (str target)))

(defn event-files [dir]
  (if (fs/exists? dir)
    (->> (fs/list-dir dir "*.edn")
         (map str)
         sort)
    []))

(defn all-events []
  (for [dir [(pending-dir) (done-dir) (failed-dir) (unhandled-dir)]
        path (event-files dir)
        :let [event (read-event path)]
        :when event]
    (assoc event ::path path)))

(defn dedupe-window-seconds []
  (env-long "CODEX_TASK_BOARD_EVENT_DEDUPE_SECONDS" "900"))

(defn recent-duplicate
  "An event for the same ticket and target status created inside the dedupe
  window. Runner-recorded and board-diff events for the same transition
  collapse into one wake-up."
  [ticket-id to-status]
  (let [window (dedupe-window-seconds)]
    (first (filter (fn [e]
                     (and (not= "task-board.morning-digest" (:event-type e))
                          (= ticket-id (:ticket-id e))
                          (= to-status (:to-status e))
                          (< (seconds-since (:created-at e)) window)))
                   (all-events)))))

(defn build-event [{:keys [event-id ticket-id run-id from-status to-status result source]}]
  {:schema-version schema-version
   :event-id event-id
   :event-type (if run-id "task-board.run-finished" "task-board.lane-changed")
   :ticket-id ticket-id
   :run-id run-id
   :from-status from-status
   :to-status to-status
   :result result
   :source source
   :revision (ticket-revision ticket-id)
   :created-at (now-str)
   :status :pending
   :attempts 0
   :redeliveries 0})

(defn record-event!
  "Persist an event unless the status is not a trigger or a duplicate exists.
  Returns the written path, or nil when nothing was recorded."
  [{:keys [ticket-id to-status] :as spec}]
  (when (contains? trigger-statuses to-status)
    (if-let [dup (recent-duplicate ticket-id to-status)]
      (do (log! (str "skip duplicate event for " ticket-id " -> " to-status
                     " (existing " (:event-id dup) ")"))
          nil)
      (let [event (build-event spec)
            path (write-event! (pending-dir) event)]
        (log! (str "recorded " (:event-type event) " " (:event-id event)
                   " ticket=" ticket-id " " (:from-status event) "->" to-status
                   " source=" (:source event)))
        path))))

(defn record-run-event!
  "Called by the runner after a run's final transition has been committed."
  [ticket-id run-id from-status to-status result]
  (record-event! {:event-id (str ticket-id "-" run-id "-" to-status)
                  :ticket-id ticket-id
                  :run-id run-id
                  :from-status from-status
                  :to-status to-status
                  :result result
                  :source "task-board-runner"}))

;; ---------------------------------------------------------------------------
;; Manual Board edits: lane snapshot diff
;; ---------------------------------------------------------------------------

(defn load-snapshot []
  (if (fs/exists? (snapshot-path))
    (or (read-event (snapshot-path)) {})
    {}))

(defn save-snapshot! [lanes]
  (fs/create-dirs (outbox-dir))
  (let [tmp (str (snapshot-path) ".tmp")]
    (spit tmp (pr-str lanes))
    (fs/move tmp (snapshot-path) {:replace-existing true :atomic-move true})))

(defn detect-lane-changes!
  "Compare the current Board lanes with the last snapshot and record an event
  for every ticket that entered a trigger lane. The first pass only seeds the
  snapshot so existing tickets are not reported as new. Returns the recorded
  event paths."
  []
  (let [current (board-lanes)
        previous (load-snapshot)]
    (if (and (empty? previous) (not (fs/exists? (snapshot-path))))
      (do (save-snapshot! current)
          (log! (str "seeded board snapshot with " (count current) " ticket(s)"))
          [])
      (let [recorded (doall
                      (for [[ticket-id status] current
                            :let [prev (get previous ticket-id)]
                            ;; Leaving the retired Review lane is the one-time
                            ;; migration, not news: one digest reports it instead
                            ;; of one notification per card (BOXP-395).
                            :when (and (not= prev status)
                                       (not= "review" prev)
                                       (contains? trigger-statuses status))
                            :let [path (record-event! {:event-id (str ticket-id "-lane-" status "-" (compact-ts) "-" (short-uuid))
                                                       :ticket-id ticket-id
                                                       :run-id nil
                                                       :from-status prev
                                                       :to-status status
                                                       :result nil
                                                       :source "board-diff"})]
                            :when path]
                        path))]
        (when (not= current previous)
          (save-snapshot! current))
        recorded))))

;; ---------------------------------------------------------------------------
;; Quiet hours (02:00-09:00 JST by default): events are kept, not sent
;; ---------------------------------------------------------------------------

(defn quiet-spec [] (env "CODEX_TASK_BOARD_EVENT_QUIET_HOURS" "2-9"))
(defn event-timezone [] (env "CODEX_TASK_BOARD_EVENT_TIMEZONE" "Asia/Tokyo"))

(defn quiet-hours []
  (when-let [[_ start end] (re-matches #"(\d{1,2})-(\d{1,2})" (quiet-spec))]
    [(Long/parseLong start) (Long/parseLong end)]))

;; The Hermes send gate runs in another container with its own replica of the
;; vault, kept by Obsidian Sync. Only notes cross that boundary (.json is not in
;; the synced file types), so every file shared with the gate is a .md note with
;; one writer, and nothing here may rely on atomicity across the two replicas.
;; This dispatcher publishes its effective window as the source of truth for the gate.
(defn publish-quiet-policy! []
  (let [path (fs/path (vault) "Projects/task-board-events/quiet-policy.md")
        body (json/generate-string {:quiet_hours (quiet-spec) :timezone (event-timezone)})]
    (when-not (= body (try (slurp (str path)) (catch Exception _ nil)))
      (fs/create-dirs (fs/parent path))
      (let [temporary (fs/create-temp-file {:dir (fs/parent path) :prefix ".quiet-policy-"})]
        (try (spit (str temporary) body)
             (fs/move temporary path {:replace-existing true :atomic-move true})
             (finally (fs/delete-if-exists temporary)))))))

(defn quiet-at? [^Instant instant]
  (when-let [[start end] (quiet-hours)]
    (let [zone (ZoneId/of (event-timezone))
          hour (.getHour (ZonedDateTime/ofInstant instant zone))]
      (if (<= start end)
        (and (>= hour start) (< hour end))
        (or (>= hour start) (< hour end))))))

(defn quiet-now? [] (quiet-at? (now)))

(def night-config-warning (atom nil))
(defn night-config []
  (let [path (str (fs/path (outbox-dir) "night-processing.edn"))
        config (try (edn/read-string (slurp path)) (catch Exception _ nil))
        valid? (and (map? config) (boolean? (:enabled config))
                    (or (nil? (:only-tickets config))
                        (and (set? (:only-tickets config)) (every? string? (:only-tickets config)))))
        warning (when (and (fs/exists? path) (not valid?)) "invalid or unreadable night-processing.edn; disabled")]
    (when (and warning (not= warning @night-config-warning)) (log! warning))
    (reset! night-config-warning warning)
    (if valid? config {:enabled false :only-tickets nil})))

;; ---------------------------------------------------------------------------
;; Signed delivery
;; ---------------------------------------------------------------------------

(defn webhook-url [] (System/getenv "CODEX_TASK_BOARD_EVENT_WEBHOOK_URL"))
(defn webhook-secret [] (System/getenv "CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET"))

(defn hmac-sha256-hex [^String secret ^String message]
  (let [mac (Mac/getInstance "HmacSHA256")]
    (.init mac (SecretKeySpec. (.getBytes secret "UTF-8") "HmacSHA256"))
    (->> (.doFinal mac (.getBytes message "UTF-8"))
         (map #(format "%02x" %))
         (apply str))))

(defn payload-json [event]
  (json/generate-string
   {:schema_version (:schema-version event)
    :event_type (:event-type event)
    :event_id (:event-id event)
    :ticket_id (:ticket-id event)
    :run_id (:run-id event)
    :from_status (:from-status event)
    :to_status (:to-status event)
    :result (:result event)
    :source (:source event)
    :revision (:revision event)
    :created_at (:created-at event)
    :attempt (inc (:attempts event 0))
    :redelivery (:redeliveries event 0)
    :notify_mode (or (:notify-mode event) "normal")
    :digest_items (if (:digest-items event) (json/generate-string (:digest-items event)) "")}))

(defn signed-headers
  "Hermes generic V2 signature: HMAC-SHA256 hex of \"<timestamp>.<body>\"."
  [secret body]
  (let [ts (str (.getEpochSecond (now)))]
    {"content-type" "application/json"
     "x-webhook-timestamp" ts
     "x-webhook-signature-v2" (hmac-sha256-hex secret (str ts "." body))}))

(defn send-event!
  "POST one event. Returns {:ok? bool :status http-status :hermes-status s :error s}."
  [event]
  (let [url (webhook-url)
        secret (webhook-secret)]
    (cond
      (str/blank? url) {:ok? false :error "CODEX_TASK_BOARD_EVENT_WEBHOOK_URL is not set"}
      (str/blank? secret) {:ok? false :error "CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET is not set"}
      :else
      (let [body (payload-json event)
            headers (assoc (signed-headers secret body)
                           "x-request-id" (:event-id event))]
        (try
          (let [resp (http/post url {:headers headers
                                     :body body
                                     :timeout (* 1000 (env-long "CODEX_TASK_BOARD_EVENT_HTTP_TIMEOUT_SECONDS" "15"))
                                     :throw false})
                status (:status resp)
                parsed (try (json/parse-string (:body resp) true) (catch Exception _ nil))]
            (if (<= 200 status 299)
              {:ok? true :status status :hermes-status (or (:status parsed) "accepted")}
              {:ok? false :status status :error (str "http " status)}))
          (catch Exception e
            {:ok? false :error (str "transport: " (.getMessage e))}))))))

(defn backoff-seconds [attempts]
  (min (env-long "CODEX_TASK_BOARD_EVENT_MAX_BACKOFF_SECONDS" "600")
       (* 15 (long (Math/pow 2 (max 0 (dec attempts)))))))

(defn max-attempts [] (env-long "CODEX_TASK_BOARD_EVENT_MAX_ATTEMPTS" "40"))
(defn handle-timeout-seconds [] (env-long "CODEX_TASK_BOARD_EVENT_HANDLE_TIMEOUT_SECONDS" "1800"))
(defn max-redeliveries [] (env-long "CODEX_TASK_BOARD_EVENT_MAX_REDELIVERIES" "2"))
(defn done-retention-days [] (env-long "CODEX_TASK_BOARD_EVENT_DONE_RETENTION_DAYS" "14"))

(defn due? [event]
  (let [next-at (:next-attempt-at event)]
    (or (str/blank? next-at)
        (>= (seconds-since next-at) 0))))

(defn move-event! [event dir]
  (fs/create-dirs dir)
  (let [target (fs/path dir (str (:event-id event) ".edn"))]
    (write-event! dir (dissoc event ::path))
    (fs/delete-if-exists (::path event))
    (str target)))

(declare digest?)

(defn flush-pending!
  "Send due pending events in creation order. During quiet hours nothing is
  sent and every event stays in the outbox."
  []
  (let [config (night-config)
        quiet? (quiet-now?)
        pending (->> (event-files (pending-dir))
                     (keep (fn [p] (some-> (read-event p) (assoc ::path p))))
                     (filter #(= :pending (:status %)))
                     (sort-by :created-at))]
    (cond
      (empty? pending) {:sent 0 :deferred 0 :failed 0}

      :else
      (reduce (fn [acc event]
                (if (or (not (due? event))
                        (and quiet? (or (digest? event) (not (and (:enabled config)
                                              (or (nil? (:only-tickets config))
                                                  (contains? (:only-tickets config) (:ticket-id event))))))))
                  (do (when (and quiet? (due? event)) (log! "pending event deferred by quiet hours"))
                      (update acc :deferred inc))
                  (let [mode (if quiet? "defer" "normal")
                        ;; The start of this delivery, kept across retries and saved before the
                        ;; POST: Hermes can finish and write its receipt before we see the response,
                        ;; and a lost response or a crash here ends in a retry of the same delivery.
                        first-attempt? (not (:delivery-started-at event))
                        event (assoc event :notify-mode mode
                                     :delivery-started-at (or (:delivery-started-at event) (now-str)))
                        _ (when first-attempt? (write-event! (pending-dir) (dissoc event ::path)))
                        {:keys [ok? status hermes-status error]} (send-event! event)
                        attempts (inc (:attempts event 0))]
                    (if ok?
                      (do (write-event! (pending-dir)
                                        (-> event
                                            (dissoc ::path :next-attempt-at :last-error)
                                            (assoc :status :accepted
                                                   :attempts attempts
                                                   :accepted-at (now-str)
                                                   :last-http-status status
                                                   :hermes-status hermes-status)))
                          (log! (str "accepted " (:event-id event) " http=" status
                                     " hermes=" hermes-status " attempt=" attempts))
                          (update acc :sent inc))
                      (let [event (-> event
                                      (assoc :attempts attempts
                                             :last-error error
                                             :last-http-status status
                                             :last-attempt-at (now-str)))]
                        (if (>= attempts (max-attempts))
                          (do (move-event! (assoc event :status :failed :failed-at (now-str)) (failed-dir))
                              (log! (str "giving up on " (:event-id event) " after " attempts
                                         " attempt(s): " error))
                              (update acc :failed inc))
                          (let [delay (backoff-seconds attempts)]
                            (write-event! (pending-dir)
                                          (-> event
                                              (dissoc ::path)
                                              (assoc :next-attempt-at
                                                     (str (.plusSeconds (now) delay)))))
                            (log! (str "send failed for " (:event-id event) " attempt=" attempts
                                       " retry-in=" delay "s: " error))
                            (update acc :deferred inc))))))))
              {:sent 0 :deferred 0 :failed 0}
              pending))))

;; ---------------------------------------------------------------------------
;; Processing completion: Kohako appends a Notes line that names the event id
;; ---------------------------------------------------------------------------

(defn marker-result [line event-id]
  (let [prefix (first (str/split line #"\bsummary=" 2))]
    (when (and (re-find (re-pattern (str "(?:^|\\s)event=" (java.util.regex.Pattern/quote event-id) "(\\s|$)")) prefix)
               (re-find #"(?i)handled" prefix))
      (or (some-> (re-find #"(?:^|\s)result=(notified|question|silent|continued|deferred)(?:\s|$)" prefix) second keyword)
          :legacy))))

(defn handled-marker? [line event-id] (boolean (marker-result line event-id)))
(defn handled-in-notes? [event]
  (try (last (keep #(marker-result % (:event-id event))
                   (str/split-lines (slurp (ticket-path (:ticket-id event))))) )
       (catch Exception _ nil)))

(defn current-receipt
  "A receipt only speaks for the current delivery: one older than the start of
  that delivery says nothing about what it did. Events accepted before
  :delivery-started-at existed fall back to :accepted-at."
  [event]
  (try (let [r (json/parse-string (slurp (str (fs/path (vault) "Projects/task-board-events/delivery-receipts" (str (:event-id event) ".md")))) true)
             stale? (and (:updated_at r)
                         (.isBefore (.toInstant (OffsetDateTime/parse (:updated_at r)))
                                    (Instant/parse (or (:delivery-started-at event) (:accepted-at event)))))]
         (when (and (= (:event r) (:event-id event)) (not stale?)) r))
       (catch Exception _ nil)))
(defn receipt-state [event] (:state (current-receipt event)))
;; The gate classifies what it sent: "unresolved" carried its reconciliation notice,
;; so that send does not prove the business report arrived.
(defn unconfirmed-send? [event]
  (let [r (current-receipt event)] (and (= "sent" (:state r)) (= "unresolved" (:classification r)))))
(defn digest? [e] (= "task-board.morning-digest" (:event-type e)))
(defn digest-item-ids [e] (set (mapcat #(cons (:event-id %) (:superseded %)) (:digest-items e))))
(defn finish-items! [digest dir status]
  (doseq [path (event-files (pending-dir))
          :let [item (read-event path)]
          :when (and item (contains? (digest-item-ids digest) (:event-id item)))]
    (move-event! (assoc item ::path path :digest-id (:event-id digest) :status status
                        (if (= status :handled) :delivered-at :unhandled-at) (now-str)) dir)))

(defn reissue-digest!
  "Hermes dedupes on the event id, so re-sending a held digest under its old id
  would never run the agent again. Continue under a new id derived from the old
  one: an interrupted reissue resumes on the next tick without a second digest."
  [digest]
  (let [old-id (:event-id digest)
        id (str/replace old-id #"[a-f0-9]+$" (subs (sha256-hex old-id) 0 12))]
    (when-not (some #(fs/exists? (fs/path % (str id ".edn")))
                    [(pending-dir) (done-dir) (failed-dir) (unhandled-dir)])
      (write-event! (pending-dir)
                    (-> digest
                        (dissoc ::path :delivery-started-at :accepted-at :processed-at :last-http-status :hermes-status)
                        (assoc :event-id id :status :pending :attempts 0 :redeliveries 0
                               :created-at (now-str) :reissue-of old-id))))
    (doseq [path (event-files (pending-dir))
            :let [item (read-event path)]
            :when (and item (= :notify-pending (:status item))
                       (contains? (digest-item-ids digest) (:event-id item)))]
      (write-event! (pending-dir) (assoc item :digest-id id)))
    (move-event! (assoc digest :status :superseded :superseded-by id :superseded-at (now-str)) (done-dir))
    (log! (str "quiet-held digest " old-id " reissued as " id))))

(defn reconcile-accepted! []
  ;; Finish orphaned items after a crash or a digest transport failure.
  (let [events (vec (all-events))
        by-id (into {} (map (juxt :event-id identity) events))]
    (doseq [item events :when (and (= :notify-pending (:status item)) (:digest-id item))]
      (let [digest (get by-id (:digest-id item))]
        (when (or (nil? digest) (#{:failed :unhandled :notify-undelivered} (:status digest)))
          (move-event! (assoc item :status :notify-undelivered :unhandled-at (now-str)) (unhandled-dir)))
        (when (= :handled (:status digest))
          (move-event! (assoc item :status :handled :delivered-at (now-str)) (done-dir)))))
    ;; A send can land after an item returned to the digest queue (late reply past the
    ;; timeout): once it may have gone out, the digest must not repeat it.
    (doseq [item events :when (and (= :notify-pending (:status item)) (nil? (:digest-id item)) (not (digest? item)))]
      (when-let [state (#{"sent" "uncertain"} (receipt-state item))]
        (move-event! (assoc item :status :notify-undelivered :unhandled-at (now-str) :delivery-receipt state) (unhandled-dir))
        (log! (str "delivery unconfirmed " (:event-id item)))))
    (reduce (fn [acc event]
              (let [marker (handled-in-notes? event)
                    receipt (receipt-state event)
                    digest (digest? event)
                    unconfirmed (unconfirmed-send? event)
                    timeout? (>= (seconds-since (:accepted-at event)) (handle-timeout-seconds))]
                (cond
                  ;; A hold proves nothing was sent, marker or not.
                  (and digest (= receipt "quiet-held"))
                  (do (reissue-digest! event)
                      (update acc :waiting inc))
                  (= receipt "quiet-held")
                  (do (write-event! (pending-dir) (-> event (dissoc ::path) (assoc :status :notify-pending :processed-at (now-str))))
                      (update acc :waiting inc))
                  ;; A send that may have happened is never redelivered, marker or not.
                  (= receipt "uncertain")
                  (do (when digest (finish-items! event (unhandled-dir) :notify-undelivered))
                      (move-event! (assoc event :status :notify-undelivered :unhandled-at (now-str) :delivery-receipt receipt)
                                   (unhandled-dir))
                      (log! (str "delivery unconfirmed " (:event-id event)))
                      (update acc :unhandled inc))
                  ;; The marker is written before the agent's final reply, so only the gate's
                  ;; proof of the [SILENT] rules out a send that the digest would repeat.
                  (and (not digest) (= marker :deferred) (= receipt "silent"))
                  (do (write-event! (pending-dir) (-> event (dissoc ::path) (assoc :status :notify-pending :processed-at (now-str))))
                      (update acc :waiting inc))
                  ;; A notified/question marker is written before the send, which may
                  ;; come late and be held: only the gate's receipt proves the outcome.
                  (and marker (or (and (not digest) (not (#{:notified :question :deferred} marker)))
                                  (and (#{:notified :question :silent} marker) (= receipt "sent") (not unconfirmed))
                                  ;; Only the gate's proof of an intentional [SILENT] ends a digest without a send.
                                  (and digest (= marker :silent) (= receipt "silent"))))
                  (do (when digest (finish-items! event (done-dir) :handled))
                      (move-event! (assoc event :status :handled :handled-at (now-str)) (done-dir))
                      (update acc :handled inc))
                  ;; A sent receipt without a marker, or one that carried the gate's notice, is
                  ;; not a confirmed report: a late marker or report may still finish it, then the
                  ;; 180m cron reconciles it.
                  (or (and marker digest timeout?) (and (= receipt "sent") (or (not marker) unconfirmed (= marker :deferred)) timeout?))
                  (do (when digest (finish-items! event (unhandled-dir) :notify-undelivered))
                      (move-event! (cond-> (assoc event :status :notify-undelivered :unhandled-at (now-str))
                                     receipt (assoc :delivery-receipt receipt))
                                   (unhandled-dir))
                      (log! (str "delivery unconfirmed " (:event-id event)))
                      (update acc :unhandled inc))
                  ;; No gate evidence by the timeout: the morning digest still reports it.
                  (and marker timeout?)
                  (do (write-event! (pending-dir) (-> event (dissoc ::path) (assoc :status :notify-pending :processed-at (now-str))))
                      (log! (str "no delivery receipt, returning to digest " (:event-id event)))
                      (update acc :waiting inc))
                  (not timeout?) (update acc :waiting inc)
                  (and (not marker) (< (:redeliveries event 0) (max-redeliveries)))
                  (do (write-event! (pending-dir) (-> event (dissoc ::path :delivery-started-at :accepted-at)
                                                     (assoc :status :pending :redeliveries (inc (:redeliveries event 0)))))
                      (update acc :redelivered inc))
                  :else
                  (do (when digest (finish-items! event (unhandled-dir) :notify-undelivered))
                      (move-event! (assoc event :status :unhandled :unhandled-at (now-str)) (unhandled-dir))
                      (update acc :unhandled inc)))))
            {:handled 0 :waiting 0 :redelivered 0 :unhandled 0}
            (filter #(= :accepted (:status %)) events))))

(defn digest-claim-grace-seconds [] (env-long "CODEX_TASK_BOARD_EVENT_DIGEST_CLAIM_GRACE_SECONDS" "300"))

(defn publish-digest-claim!
  "Tell the gate this event's report now belongs to the digest, so a late reply is
  held instead of sent. The replicas allow no exclusive claim: a send that crossed
  this note in flight shows up as a receipt during the grace period and takes the
  item out of the digest. Only a sync stalled longer than the grace can still send
  twice, and that never loses the report."
  [event-id]
  (let [path (fs/path (vault) "Projects/task-board-events/delivery-claims" (str event-id ".md"))]
    (fs/create-dirs (fs/parent path))
    (let [temporary (fs/create-temp-file {:dir (fs/parent path) :prefix ".claim-"})]
      (try (spit (str temporary) (json/generate-string {:event event-id :owner "digest"}))
           (fs/move temporary path {:replace-existing true :atomic-move true})
           (finally (fs/delete-if-exists temporary))))))

(defn claim-for-digest!
  "Returns the item with its claim published, keeping the first publish time."
  [item]
  (if (:digest-claimed-at item)
    item
    (let [claimed (assoc item :digest-claimed-at (now-str))]
      (publish-digest-claim! (:event-id item))
      (write-event! (pending-dir) (dissoc claimed ::path))
      claimed)))

(defn build-digest! []
  (if (quiet-now?) 0
      (let [events (vec (all-events))
            digests (remove #(= :superseded (:status %)) (filter digest? events))
            ;; A digest is written before its items are stamped; repair interrupted writes first.
            claimed (into {} (mapcat (fn [d] (map (fn [id] [id (:event-id d)]) (digest-item-ids d))) digests))
            pending (filter #(and (= :notify-pending (:status %)) (not (digest? %))) events)]
        (doseq [item pending :let [id (get claimed (:event-id item))] :when (and id (nil? (:digest-id item)))]
          (write-event! (pending-dir) (-> item (dissoc ::path) (assoc :digest-id id))))
        ;; A morning's items are claimed on the same tick, so they stay one digest. A later
        ;; item waits for the next one: waiting for all could starve held reports.
        (let [items (->> (remove #(or (:digest-id %) (get claimed (:event-id %))) pending)
                         (mapv claim-for-digest!)
                         (filter #(>= (seconds-since (:digest-claimed-at %)) (digest-claim-grace-seconds))))]
          (if (empty? items) 0
              (let [ordered (sort-by (juxt :created-at :event-id) items)
                    groups (vals (group-by :ticket-id ordered))
                    entries (->> groups (map (fn [xs] (let [xs (sort-by (juxt :created-at :event-id) xs) newest (last xs)]
                                                       {:ticket-id (:ticket-id newest) :event-id (:event-id newest)
                                                        :to-status (:to-status newest) :superseded (mapv :event-id (butlast xs))})))
                                 (sort-by :ticket-id) vec)
                    anchor (first ordered)
                    hash (subs (sha256-hex (str/join "\n" (sort (map :event-id items)))) 0 12)
                    ts (-> (:created-at anchor) (str/replace #"[-:]" "") (str/replace #"\.\d+" ""))
                    id (str (:ticket-id anchor) "-digest-" ts "-" hash)
                    digest {:schema-version schema-version :event-id id :event-type "task-board.morning-digest"
                            :ticket-id (:ticket-id anchor) :created-at (now-str) :status :pending
                            :attempts 0 :redeliveries 0 :digest-items entries}]
                (write-event! (pending-dir) digest)
                (doseq [item items] (write-event! (pending-dir) (-> item (dissoc ::path) (assoc :digest-id id))))
                1))))))

(defn prune-done! []
  (let [max-age (* 86400 (done-retention-days))]
    (doseq [path (event-files (done-dir))
            :let [event (read-event path)]
            :when (and event (> (seconds-since (:created-at event)) max-age))]
      (fs/delete-if-exists path))))


;; ---------------------------------------------------------------------------
;; BOXP-501: copy to the kohako-home notification inbox
;; ---------------------------------------------------------------------------
;; Copy only text actually sent to Telegram, using the synced delivered copy.
;; Home state and retries remain independent; unsetting the URL disables delivery.
;; Silent events are skipped; missing copies wait for sync (quiet-held/digest-folded wait longer).
;; Home IDs are <event>.report / <event>.notice: a reconciliation notice never shadows the
;; later formal report, and legacy raw lane-change items (home state <event>.edn, BFF item
;; <event>) neither block nor deduplicate the delivered copy.

(defn home-url [] (System/getenv "CODEX_TASK_BOARD_EVENT_HOME_URL"))
(defn home-token-path [] (env "CODEX_TASK_BOARD_EVENT_HOME_TOKEN_FILE" "/var/run/secrets/kohako-bff-notifier/token"))
(defn home-dir [] (str (fs/path (outbox-dir) "home")))
(defn home-max-age-seconds [] (env-long "CODEX_TASK_BOARD_EVENT_HOME_MAX_AGE_SECONDS" "21600"))
(defn home-max-attempts [] (env-long "CODEX_TASK_BOARD_EVENT_HOME_MAX_ATTEMPTS" "20"))

(defn ticket-title [ticket-id]
  (let [path (ticket-path ticket-id)]
    (when (and ticket-id (fs/exists? path))
      (some (fn [line] (when-let [[_ t] (re-matches #"#\s+[A-Z]+-\d+:\s*(.+)" line)] (str/trim t)))
            (str/split-lines (slurp path))))))

(defn clip [s n] (let [s (str s)] (if (> (count s) n) (subs s 0 n) s)))

(defn delivered-copy [event kind]
  (try (let [copy (json/parse-string (slurp (str (fs/path (vault) "Projects/task-board-events/delivered-copies" (str (:event-id event) kind ".md")))) true)]
         (when (and (= (:event copy) (:event-id event)) (string? (:text copy)) (not (str/blank? (:text copy)))) copy))
       (catch Exception _ nil)))

(defn extract-choices [text]
  (let [letters (vec (distinct (keep #(second (re-find #"^\s*(?:[-*・]\s*)?(?:\*\*)?([A-F])[)）.．:：](?:\*\*)?\s*\S" %)) (str/split-lines text))))]
    (when (and (>= (count letters) 2) (= letters (mapv str (take (count letters) "ABCDEF")))) letters)))

(defn home-payload [event home-id copy]
  (let [tid (:ticket-id event)
        text (:text copy)
        body (if (> (count text) 4000) (str (subs text 0 3999) "…") text)
        title (if (digest? event) "Task Board 朝のまとめ" (str tid ": " (or (ticket-title tid) tid)))]
    (cond-> {:eventId home-id :source "task-board-report" :eventType (:event-type event)
             :title (clip title 200) :body body :createdAt (:created-at event)}
      (extract-choices text) (assoc :choices (extract-choices text))
      (and tid (re-matches #"[A-Z]+-\d+" tid)) (assoc :ticketId tid)
      (:run-id event) (assoc :runId (clip (:run-id event) 120)))))

(defn read-home-state [event-id]
  (let [path (fs/path (home-dir) (str event-id ".edn"))]
    (when (fs/exists? path) (read-event path))))

(defn send-home! [event home-id copy]
  (let [token (try (str/trim (slurp (home-token-path))) (catch Exception _ nil))]
    (if (str/blank? token)
      {:ok? false :error "home token unavailable"}
      (try
        (let [resp (http/post (home-url) {:headers {"content-type" "application/json"
                                                    "authorization" (str "Bearer " token)
                                                    "x-request-id" home-id}
                                          :body (json/generate-string (if (= (:source copy) "hermes-cron") (:payload copy) (home-payload event home-id copy)))
                                          :timeout (* 1000 (env-long "CODEX_TASK_BOARD_EVENT_HTTP_TIMEOUT_SECONDS" "15"))
                                          :throw false})
              status (:status resp)
              parsed (try (json/parse-string (:body resp) true) (catch Exception _ nil))
              push (:push parsed)
              home-push (when (map? push)
                          (cond-> (into {} (filter (fn [[_ v]] (and (integer? v) (<= 0 v))) (select-keys push [:subscriptions :sent :errors :removed])))
                            (#{"quiet" "no-subscriptions" "error"} (:pushSkipped push)) (assoc :pushSkipped (:pushSkipped push))))]
          (cond (<= 200 status 299) {:ok? true :status status :home-status (:status parsed) :home-push home-push}
                (and (<= 400 status 499) (not= 429 status) (not= 401 status)) {:ok? false :permanent? true :status status :error (str "http " status)}
                :else {:ok? false :status status :error (str "http " status)}))
        (catch Exception e {:ok? false :error (str "transport: " (.getMessage e))})))))

(defn send-home-copy!
  "Send one delivered copy under its home ID, recording per-ID state. Returns acc."
  [acc event home-id state copy]
  (let [{:keys [ok? permanent? status home-status home-push error]} (send-home! event home-id copy)
        attempts (inc (:attempts state 0))
        base (cond-> (merge state {:event-id home-id :attempts attempts :last-http-status status :updated-at (now-str)})
               (= "home" (:primary copy)) (assoc :primary "home"))]
    (cond
      ok? (do (write-event! (home-dir) (cond-> (assoc base :status :sent :home-status home-status :sent-at (now-str)) (seq home-push) (assoc :home-push home-push)))
              (log! (str "home inbox " home-id " http=" status " status=" home-status
                         (when (seq home-push)
                           (if-let [skipped (:pushSkipped home-push)]
                             (str " push=skipped:" skipped " subs:" (:subscriptions home-push))
                             (str " push=sent:" (:sent home-push) "/" (:subscriptions home-push) " errors:" (:errors home-push) " removed:" (:removed home-push))))))
              (update acc :home-sent inc))
      (or permanent? (>= attempts (home-max-attempts)))
      (do (write-event! (home-dir) (assoc base :status :failed :last-error error))
          (log! (str "home inbox gave up on " home-id ": " error))
          (update acc :home-failed (fnil inc 0)))
      :else
      (do (write-event! (home-dir) (assoc base :status :retry :last-error error
                                          :next-attempt-at (str (.plusSeconds (now) (backoff-seconds attempts)))))
          (update acc :home-retry (fnil inc 0))))))

(defn home-waiting? [state]
  (and (:next-attempt-at state) (.isAfter (Instant/parse (:next-attempt-at state)) (now))))

(defn home-quiet-max-age-seconds [] (env-long "CODEX_TASK_BOARD_EVENT_HOME_QUIET_MAX_AGE_SECONDS" "64800"))

(defn copy-age-seconds
  "Age of a delivered copy measured from its Telegram send time (falls back to the event)."
  [event copy]
  (or (try (when (string? (:sent_at copy))
              (- (.getEpochSecond (now)) (.getEpochSecond (.toInstant (java.time.OffsetDateTime/parse (:sent_at copy))))))
            (catch Exception _ nil))
      (seconds-since (:created-at event))))

(defn flush-home-copy
  "One home ID (report or notice) of one event. Each ID advances independently, so a
  notice is never cut off by the report (or vice versa)."
  [acc event home-id copy-kind skip-reason]
  (let [state (read-home-state home-id)
        copy (delivered-copy event copy-kind)]
    (cond
      (contains? #{:sent :failed :skipped} (:status state)) acc
      copy (cond
             (home-waiting? state) acc
             (> (copy-age-seconds event copy) (home-max-age-seconds))
             (do (write-event! (home-dir) {:event-id home-id :status :skipped :reason "stale-copy" :updated-at (now-str)}) acc)
             :else (send-home-copy! acc event home-id state copy))
      skip-reason (do (write-event! (home-dir) {:event-id home-id :status :skipped :reason skip-reason :updated-at (now-str)}) acc)
      :else acc)))


(defn reminder-url [] (System/getenv "CODEX_TASK_BOARD_HOME_REMINDER_URL"))

(defn home-status [home-id]
  (try
    (let [token (str/trim (slurp (home-token-path)))
          url (str (str/replace (home-url) #"/ingest$" "/status") "?ids=" (java.net.URLEncoder/encode home-id "UTF-8"))
          response (http/get url {:headers {"authorization" (str "Bearer " token)} :throw false
                                  :timeout (* 1000 (env-long "CODEX_TASK_BOARD_EVENT_HTTP_TIMEOUT_SECONDS" "15"))})
          item (get-in (json/parse-string (:body response)) ["items" home-id])]
      (when (and (<= 200 (:status response) 299) (map? item)
                 (every? boolean? (map item ["exists" "read" "handled" "replied"]))) item))
    (catch Exception _ nil)))

(defn flush-home-reminder! [event]
  (let [home-id (str (:event-id event) ".report")
        copy (delivered-copy event "")
        state (read-home-state home-id)]
    ;; 催促・fallback は送信から一定時間内の通知だけ。保存期限で状態が prune された古い通知へ再送しない。
    (when (and (= "home" (:primary copy)) (not (str/blank? (reminder-url)))
               (< (copy-age-seconds event copy) (* 3600 (env-long "CODEX_TASK_BOARD_HOME_REMINDER_MAX_AGE_HOURS" "24")))
               (not (contains? #{:sent :failed :unneeded} (:reminder-status state))))
      (let [state (assoc (or state {:event-id home-id}) :primary "home")
            stored? (and (= :sent (:status state)) (contains? #{"stored" "duplicate"} (:home-status state)))
            fallback? (and (not stored?) (or (= :failed (:status state))
                           (>= (copy-age-seconds event copy) (* 60 (env-long "CODEX_TASK_BOARD_HOME_FALLBACK_MINUTES" "20")))))
            due? (and stored? (:sent-at state)
                      (>= (seconds-since (:sent-at state)) (* 60 (env-long "CODEX_TASK_BOARD_HOME_REMINDER_MINUTES" "30"))))]
        (when (and (not (quiet-now?)) (or fallback? due?))
          (let [status (when due? (home-status home-id))
                checks (inc (:reminder-check-attempts state 0))
                checked (cond-> state due? (assoc :reminder-check-attempts checks))
                ;; 家から通知が消えている(exists=false)なら本文なしの催促では内容が分からないため本文付き fallback にする。
                missing? (and status (false? (get status "exists")))
                fallback? (or fallback? missing?)
                done? (and status (not missing?) (some true? (map status ["read" "handled" "replied"])))
                ready? (or fallback? status (>= checks (home-max-attempts)))]
            (cond
              done? (write-event! (home-dir) (assoc checked :reminder-status :unneeded :updated-at (now-str)))
              (not ready?) (write-event! (home-dir) (assoc checked :updated-at (now-str)))
              :else
              (let [kind (if fallback? "fallback" "reminder")
                    id (str (:event-id event) "." kind)
                    url (str "https://kohako-home.b0xp.io/?notification=" (java.net.URLEncoder/encode home-id "UTF-8"))
                    title (:title (home-payload event home-id copy))
                    message (if fallback? (str "【家へ届かなかったためTelegramで送ります】\n" (:text copy))
                                (str "【家の通知】" title " — 家の受信箱に未読の通知があります。" url))
                    body (json/generate-string {:kind kind :event_id (:event-id event) :ticket_id (:ticket-id event)
                                                :title title :text message :url url})
                    attempts (inc (:reminder-attempts state 0))
                    ok? (try (when-not (str/blank? (webhook-secret))
                               (let [resp (http/post (reminder-url) {:headers (assoc (signed-headers (webhook-secret) body)
                                                                                   "x-request-id" id "x-delivery-id" id)
                                                                     :body body :throw false
                                                                     :timeout (* 1000 (env-long "CODEX_TASK_BOARD_EVENT_HTTP_TIMEOUT_SECONDS" "15"))})]
                                 (<= 200 (:status resp) 299)))
                             (catch Exception _ false))
                    result (cond ok? :sent (>= attempts (home-max-attempts)) :failed :else :retry)]
                (write-event! (home-dir) (assoc checked :reminder-status result :reminder-kind kind
                                                :reminder-attempts attempts :updated-at (now-str)))
                (when (= result :failed) (log! (str "home reminder gave up on " home-id)))))))))))

(defn home-reminder-ready-path [] (str (fs/path (vault) "Projects/task-board-events/home-reminder-ready.json")))

(defn publish-home-reminder-ready!
  "Hermes の配信 gate は、この heartbeat が新しく reminder_ready=true の間だけ家主配信を有効にする。
  催促 URL/secret が無い dispatcher では false を書き、gate は Telegram 主配信のまま(fail safe)。"
  []
  (let [ready? (and (not (str/blank? (home-url))) (not (str/blank? (reminder-url))) (not (str/blank? (webhook-secret))))
        path (home-reminder-ready-path)
        current (try (json/parse-string (slurp path) true) (catch Exception _ nil))
        refresh (* 60 (env-long "CODEX_TASK_BOARD_HOME_READY_REFRESH_MINUTES" "10"))]
    (when (or (not= ready? (:reminder_ready current))
              (not (:checked_at current))
              (>= (or (try (seconds-since (:checked_at current)) (catch Exception _ nil)) refresh) refresh))
      (try
        (fs/create-dirs (fs/parent path))
        (let [temporary (str path ".tmp")]
          (spit temporary (json/generate-string {:reminder_ready ready? :checked_at (now-str)}))
          (fs/move temporary path {:replace-existing true :atomic-move true}))
        (catch Exception e (log! (str "home reminder heartbeat failed: " (.getMessage e))))))
    ready?))

(defn flush-home!
  "Copy each event's Telegram-delivered report and reconciliation notice to the home inbox once."
  []
  ;; home URL が外れた時も heartbeat を false に更新し、Hermes gate を即 Telegram 主配信へ戻す。
  (publish-home-reminder-ready!)
  (if (str/blank? (home-url))
    {:home-sent 0}
    (do
     (reduce
     (fn [acc event]
       (if-let [id (:event-id event)]
         (let [receipt (receipt-state event)
               age (seconds-since (:created-at event))
               ;; A report can reach Telegram after the quiet window (quiet-held / digest),
               ;; and its later "sent" receipt may sync before the copy itself. The receipt
               ;; seen now does not tell whether the event was ever held, so every non-silent
               ;; event waits for its copy over the quiet window; freshness of a copy that
               ;; does arrive is still judged by its Telegram send time.
               no-copy-reason (cond
                                (= receipt "silent") "silent"
                                (> age (home-quiet-max-age-seconds)) "no-telegram-copy")
               notice-reason (when (> age (home-quiet-max-age-seconds)) "no-telegram-copy")]
           (let [result (-> acc
                            (flush-home-copy event (str id ".notice") ".notice" notice-reason)
                            (flush-home-copy event (str id ".report") "" no-copy-reason))]
             (flush-home-reminder! event)
             result))
         acc))
     {:home-sent 0}
     (sort-by :created-at (all-events))))))


(defn cron-copy-dir [] (str (fs/path (vault) "Projects/cron-deliveries/delivered-copies")))

(defn flush-cron-home! []
  (if (str/blank? (home-url))
    {:home-sent 0}
    (reduce
     (fn [acc path]
       (try
         (let [copy (json/parse-string (slurp (str path)) true)
               id (:id copy) text (:text copy) sent (:sent_at copy)
               age (when (string? sent) (- (.getEpochSecond (now)) (.getEpochSecond (.toInstant (java.time.OffsetDateTime/parse sent)))))
               valid (and (string? id) (re-matches #"[A-Za-z0-9_.-]{8,200}" id)
                          (= (str id ".md") (str (fs/file-name path)))
                          (string? text) (not (str/blank? text)) (string? (:job_name copy)) (not (str/blank? (:job_name copy)))
                          (string? (:job_id copy)) (re-matches #"[A-Za-z0-9_-]{1,64}" (:job_id copy))
                          (boolean? (:failure copy)) age)
               state (when valid (read-home-state id))]
           (cond
             (not valid) acc
             (contains? #{:sent :failed :skipped} (:status state)) acc
             (home-waiting? state) acc
             (> age (home-max-age-seconds)) (do (write-event! (home-dir) {:event-id id :status :skipped :reason "stale-copy" :updated-at (now-str)}) acc)
             :else (let [payload (cond-> {:eventId id :source "hermes-cron" :eventType (if (:failure copy) "cron.failure" "cron.report")
                                         :title (clip (str (if (:failure copy) "失敗: " "") (:job_name copy)) 200)
                                         :body (clip text 4000) :createdAt sent :jobId (:job_id copy)}
                                   (extract-choices text) (assoc :choices (extract-choices text))
                                   (and (string? (:execution_id copy)) (not (str/blank? (:execution_id copy)))) (assoc :runId (clip (:execution_id copy) 120)))]
                     (send-home-copy! acc nil id state {:source "hermes-cron" :payload payload}))))
         (catch Exception _ acc)))
     {:home-sent 0} (fs/glob (cron-copy-dir) "*.md"))))


(defn prune-home! []
  (let [max-age (* 86400 (done-retention-days))]
    (doseq [path (event-files (home-dir))
            :let [state (read-event path)]
            :when (and state (:updated-at state) (> (seconds-since (:updated-at state)) max-age))]
      (fs/delete-if-exists path))
    (doseq [path (concat (fs/glob (str (fs/path (vault) "Projects/task-board-events/delivered-copies")) "*.md") (fs/glob (cron-copy-dir) "*.md"))
            :when (> (.getSeconds (java.time.Duration/between (.toInstant (fs/last-modified-time path)) (now))) max-age)]
      (fs/delete-if-exists path))))


;; ---------------------------------------------------------------------------
;; Entry points
;; ---------------------------------------------------------------------------

(defn tick! []
  (ensure-dirs!)
  (try (publish-quiet-policy!) (catch Exception e (log! (str "quiet policy publish failed: " (.getMessage e)))))
  (let [changes (try (detect-lane-changes!)
                     (catch Exception e (log! (str "lane diff failed: " (.getMessage e))) []))
        reconciled (try (reconcile-accepted!)
                        (catch Exception e (log! (str "reconcile failed: " (.getMessage e))) {}))
        digest (try (build-digest!) (catch Exception e (log! (str "digest failed: " (.getMessage e))) 0))
        flushed (try (flush-pending!)
                     (catch Exception e (log! (str "flush failed: " (.getMessage e))) {}))]
    (try (prune-done!) (prune-home!) (catch Exception e (log! (str "prune failed: " (.getMessage e)))))
    {:lane-events (count changes) :reconciled reconciled :digest digest :flushed flushed
     :home (try (flush-home!) (catch Exception e (log! (str "home inbox flush failed: " (.getMessage e))) {}))
     :cron-home (try (flush-cron-home!) (catch Exception e (log! (str "cron home flush failed: " (.getMessage e))) {}))}))

(defn loop! []
  (log! (str "task-board event dispatcher started, root=" (root) ", vault=" (vault)
             ", url=" (or (webhook-url) "(unset)") ", quiet-hours=" (or (quiet-hours) "disabled")
             ", secret=" (if (str/blank? (webhook-secret)) "missing" "configured")))
  (loop []
    (let [result (tick!)]
      (when (or (pos? (:lane-events result 0))
                (pos? (get-in result [:flushed :sent] 0))
                (pos? (get-in result [:flushed :failed] 0))
                (pos? (get-in result [:reconciled :handled] 0))
                (pos? (get-in result [:reconciled :unhandled] 0)))
        (log! (str "tick " (pr-str result)))))
    (Thread/sleep (* 1000 (env-long "CODEX_TASK_BOARD_EVENT_POLL_SECONDS" "30")))
    (recur)))

(defn list-events! []
  (doseq [event (sort-by :created-at (all-events))]
    (println (str (name (:status event)) "\t" (:event-id event) "\t" (:ticket-id event)
                  "\t" (:from-status event) "->" (:to-status event)
                  "\tattempts=" (:attempts event 0) " redeliveries=" (:redeliveries event 0)
                  "\t" (fs/file-name (fs/parent (::path event)))))))

(defn usage []
  (println "usage: task_board_events.bb <loop|tick|record <ticket> <run-id> <from> <to> [result]|list|test>")
  (System/exit 2))

;; ---------------------------------------------------------------------------
;; In-process unit tests (pure functions); black-box tests live in
;; tests/codex-workspace/task-board-events-test.sh
;; ---------------------------------------------------------------------------

(defn run-tests! []
  (let [failures (atom [])
        check (fn [label ok?]
                (if ok?
                  (println (str "PASS: " label))
                  (do (println (str "FAIL: " label))
                      (swap! failures conj label))))]
    (check "hmac v2 reference vector"
           (= "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
              (hmac-sha256-hex "key" "The quick brown fox jumps over the lazy dog")))
    (check "board parser keeps the first card per ticket and maps lanes"
           (= {"BOXP-1" "review" "BOXP-2" "blocked"}
              (parse-board-lanes ["# Task Board" "## Review" "- [ ] [[Tickets/BOXP-1|BOXP-1: a]] #ticket"
                                  "## Blocked" "- [ ] [[Tickets/BOXP-2|BOXP-2: b]] #ticket"
                                  "- [ ] [[Tickets/BOXP-1|BOXP-1: dup]] #ticket"])))
    (check "unknown lanes are ignored"
           (= {} (parse-board-lanes ["## Draft" "- [ ] [[Tickets/BOXP-3|BOXP-3: c]]"])))
    (check "backoff grows and is capped"
           (= [15 30 60 120 240 480 600 600] (mapv backoff-seconds [1 2 3 4 5 6 7 8])))
    (check "handled marker needs the event id and the word handled"
           (and (handled-marker? "- 2026-10-22: [kohako-event] handled event=BOXP-1-r1-review result=notified" "BOXP-1-r1-review")
                (not (handled-marker? "- 2026-10-22: [kohako-event] received event=BOXP-1-r1-review" "BOXP-1-r1-review"))
                (not (handled-marker? "- 2026-10-22: handled event=BOXP-1-r1-review-other" "BOXP-1-r1-review"))))
    (check "summary cannot forge a result"
           (= :legacy (marker-result "handled event=BOXP-1 summary=result=deferred" "BOXP-1")))
    (check "exact deferred marker parsed"
           (= :deferred (marker-result "handled event=BOXP-1 result=deferred summary=test" "BOXP-1")))
    (check "payload uses snake_case named fields only"
           (= #{"schema_version" "event_type" "event_id" "ticket_id" "run_id" "from_status" "to_status"
                "result" "source" "revision" "created_at" "attempt" "redelivery" "notify_mode" "digest_items"}
              (set (keys (json/parse-string (payload-json {:schema-version 1 :event-id "e" :ticket-id "BOXP-1"
                                                           :attempts 0 :redeliveries 0}))))))
    (check "quiet window wraps midnight when start > end"
           (let [in? (fn [h start end] (if (<= start end) (and (>= h start) (< h end)) (or (>= h start) (< h end))))]
             (and (in? 3 2 9) (not (in? 9 2 9)) (in? 23 22 6) (in? 1 22 6) (not (in? 12 22 6)))))
    (check "home payload uses delivered text"
           (let [p (home-payload {:event-id "BOXP-1-r1-done" :event-type "task-board.run-finished" :ticket-id "BOXP-1" :created-at "t"} "BOXP-1-r1-done.report" {:text "A) yes\nB) no"})]
             (and (= "task-board-report" (:source p)) (= "BOXP-1-r1-done.report" (:eventId p)) (= "A) yes\nB) no" (:body p)) (= ["A" "B"] (:choices p)))))
    (check "choice extraction requires a consecutive sequence"
           (and (= ["A" "B"] (extract-choices "- **A) yes**\n・ B： no\nA) again"))
                (nil? (extract-choices "B) yes\nC) no")) (nil? (extract-choices "A) only"))
                (nil? (extract-choices "A) yes\nC) no"))))
    (if (seq @failures)
      (do (println (str (count @failures) " test(s) failed")) (System/exit 1))
      (println "task-board-events unit tests passed"))))

(when (= (str (fs/canonicalize *file*)) (str (fs/canonicalize (System/getProperty "babashka.file"))))
  (case (or (first *command-line-args*) "tick")
    "loop" (loop!)
    "tick" (println (pr-str (tick!)))
    "record" (let [[_ ticket run-id from to result] *command-line-args*]
               (when (or (str/blank? ticket) (str/blank? run-id) (str/blank? to)) (usage))
               (println (or (record-run-event! ticket run-id from to result) "skipped")))
    "list" (list-events!)
    "test" (run-tests!)
    (usage)))
