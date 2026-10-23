#!/usr/bin/env bb
;; Child process for vault-writer-test.bb. It writes only to the temporary vault
;; and state directories passed on the command line.
(ns vault-writer-worker
  (:require [clojure.java.io :as io]))

(def root (-> (io/file *file*) .getParentFile .getParentFile .getParentFile
              .getParentFile .getParent))
(load-file (str root "/docker/codex-workspace/task-board/autonomy_control.bb"))
(in-ns 'vault-writer-worker)
(alias 'control 'autonomy-control)
(alias 'writer 'vault-writer)

(def runner-credential "synthetic-runner-credential")

(let [[mode vault state-dir store-dir worker ticket count-arg failpoint] *command-line-args*
      store (control/open-store
             {:dir store-dir
              :principals {runner-credential {:subject "synthetic-runner-subject"
                                              :role :runner}}})
      halt-at (some-> failpoint keyword)
      w (writer/open-writer
         {:vault vault
          :state-dir state-dir
          :generation 1
          :verify-generation #(true? (:ok? (control/verify-writer
                                            store runner-credential {:generation %})))
          ;; Die without unwinding, like a killed process.
          :failpoint #(when (= halt-at %) (.halt (Runtime/getRuntime) 137))})
      must-ok (fn [result]
                (when-not (true? (:ok? result))
                  (binding [*out* *err*] (println "worker failed:" (:diagnostic result)))
                  (System/exit 1)))]
  (case mode
    "notes" (dotimes [i (parse-long count-arg)]
              (must-ok (writer/update-ticket!
                        w {:ticket ticket
                           :frontmatter {(str worker "_counter") (str (inc i))}
                           :note (str "- note " worker " " (inc i))})))
    "moves" (dotimes [i (parse-long count-arg)]
              (let [[from to] (if (even? i) ["Ready" "In Progress"] ["In Progress" "Ready"])]
                (must-ok (writer/transition!
                          w {:ticket ticket :from-lane from :to-lane to
                             :note (str "- move " worker " " (inc i))}))))
    "crash" (must-ok (writer/transition!
                      w {:ticket ticket :from-lane "Ready" :to-lane "Review"
                         :frontmatter {"assignee" "boxp"}
                         :note (str "- crash " worker)}))))
