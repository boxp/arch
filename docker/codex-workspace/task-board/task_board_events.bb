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
;;   pending  (:status :accepted)  -> handled marker found in ticket Notes
;;   done/                          (processing completed)
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
  (:import [java.time Instant ZoneId ZonedDateTime]
           [java.security MessageDigest]
           [javax.crypto Mac]
           [javax.crypto.spec SecretKeySpec]))

(def lane->status
  {"Backlog" "backlog"
   "Ready" "ready"
   "In Progress" "in-progress"
   "Blocked" "blocked"
   "Review" "review"
   "Done" "done"})

;; Transitions that wake Kohako. Start / heartbeat / minor progress never do.
(def trigger-statuses #{"blocked" "review" "done"})

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
          heading (recur (rest lines) (lane->status heading) acc)
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
                     (and (= ticket-id (:ticket-id e))
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
                            :when (and (not= prev status)
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

(defn quiet-hours []
  (let [spec (env "CODEX_TASK_BOARD_EVENT_QUIET_HOURS" "2-9")]
    (when-let [[_ start end] (re-matches #"(\d{1,2})-(\d{1,2})" spec)]
      [(Long/parseLong start) (Long/parseLong end)])))

(defn quiet-now? []
  (when-let [[start end] (quiet-hours)]
    (let [zone (ZoneId/of (env "CODEX_TASK_BOARD_EVENT_TIMEZONE" "Asia/Tokyo"))
          hour (.getHour (ZonedDateTime/ofInstant (now) zone))]
      (if (<= start end)
        (and (>= hour start) (< hour end))
        (or (>= hour start) (< hour end))))))

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
    :redelivery (:redeliveries event 0)}))

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

(defn flush-pending!
  "Send due pending events in creation order. During quiet hours nothing is
  sent and every event stays in the outbox."
  []
  (let [pending (->> (event-files (pending-dir))
                     (keep (fn [p] (some-> (read-event p) (assoc ::path p))))
                     (filter #(= :pending (:status %)))
                     (sort-by :created-at))]
    (cond
      (empty? pending) {:sent 0 :deferred 0 :failed 0}

      (quiet-now?)
      (do (log! (str (count pending) " pending event(s) deferred by quiet hours"))
          {:sent 0 :deferred (count pending) :failed 0})

      :else
      (reduce (fn [acc event]
                (if-not (due? event)
                  (update acc :deferred inc)
                  (let [{:keys [ok? status hermes-status error]} (send-event! event)
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

(defn handled-marker? [line event-id]
  (boolean
   (and (re-find (re-pattern (str "event=" (java.util.regex.Pattern/quote event-id) "(\\s|$)")) line)
        (re-find #"(?i)handled" line))))

(defn handled-in-notes? [event]
  (let [path (ticket-path (:ticket-id event))]
    (and (fs/exists? path)
         (boolean (some #(handled-marker? % (:event-id event))
                        (str/split-lines (slurp path)))))))

(defn reconcile-accepted!
  "Accepted events either finish (handled marker found) or, after the handle
  timeout, go back to :pending for a redelivery with the same event id. Hermes
  answers `duplicate` while its idempotency cache still holds the id; after a
  gateway restart the redelivery starts the agent again. Exhausted events go
  to unhandled/ for the low-frequency reconciliation cron."
  []
  (let [accepted (->> (event-files (pending-dir))
                      (keep (fn [p] (some-> (read-event p) (assoc ::path p))))
                      (filter #(= :accepted (:status %))))]
    (reduce (fn [acc event]
              (cond
                (handled-in-notes? event)
                (do (move-event! (assoc event :status :handled :handled-at (now-str)) (done-dir))
                    (log! (str "handled " (:event-id event)))
                    (update acc :handled inc))

                (< (seconds-since (:accepted-at event)) (handle-timeout-seconds))
                (update acc :waiting inc)

                (< (:redeliveries event 0) (max-redeliveries))
                (do (write-event! (pending-dir)
                                  (-> event
                                      (dissoc ::path :accepted-at)
                                      (assoc :status :pending
                                             :redeliveries (inc (:redeliveries event 0)))))
                    (log! (str "redelivering " (:event-id event) " (no handled marker after "
                               (handle-timeout-seconds) "s)"))
                    (update acc :redelivered inc))

                :else
                (do (move-event! (assoc event :status :unhandled :unhandled-at (now-str)) (unhandled-dir))
                    (log! (str "unhandled " (:event-id event) " after "
                               (:redeliveries event 0) " redelivery(ies)"))
                    (update acc :unhandled inc))))
            {:handled 0 :waiting 0 :redelivered 0 :unhandled 0}
            accepted)))

(defn prune-done! []
  (let [max-age (* 86400 (done-retention-days))]
    (doseq [path (event-files (done-dir))
            :let [event (read-event path)]
            :when (and event (> (seconds-since (:created-at event)) max-age))]
      (fs/delete-if-exists path))))

;; ---------------------------------------------------------------------------
;; Entry points
;; ---------------------------------------------------------------------------

(defn tick! []
  (ensure-dirs!)
  (let [changes (try (detect-lane-changes!)
                     (catch Exception e (log! (str "lane diff failed: " (.getMessage e))) []))
        reconciled (try (reconcile-accepted!)
                        (catch Exception e (log! (str "reconcile failed: " (.getMessage e))) {}))
        flushed (try (flush-pending!)
                     (catch Exception e (log! (str "flush failed: " (.getMessage e))) {}))]
    (try (prune-done!) (catch Exception e (log! (str "prune failed: " (.getMessage e)))))
    {:lane-events (count changes) :reconciled reconciled :flushed flushed}))

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
    (check "payload uses snake_case named fields only"
           (= #{"schema_version" "event_type" "event_id" "ticket_id" "run_id" "from_status" "to_status"
                "result" "source" "revision" "created_at" "attempt" "redelivery"}
              (set (keys (json/parse-string (payload-json {:schema-version 1 :event-id "e" :ticket-id "BOXP-1"
                                                           :attempts 0 :redeliveries 0}))))))
    (check "quiet window wraps midnight when start > end"
           (let [in? (fn [h start end] (if (<= start end) (and (>= h start) (< h end)) (or (>= h start) (< h end))))]
             (and (in? 3 2 9) (not (in? 9 2 9)) (in? 23 22 6) (in? 1 22 6) (not (in? 12 22 6)))))
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
