#!/usr/bin/env bb

(require '[babashka.fs :as fs])

(load-file (str (fs/parent *file*) "/codex_cron_lib.bb"))
(require '[codex-cron-lib :as lib])

(let [[job-id] *command-line-args*]
  (when-not job-id
    (lib/fail "usage: select-codex-cron-job.bb <job-id>"))
  (let [job (lib/job job-id)
        prompt-file (lib/prompt-path job)]
    (when-not (true? (:enabled job))
      (lib/fail (str "codex cron job is disabled: " job-id)))
    (when-not (fs/exists? prompt-file)
      (lib/fail (str "prompt file does not exist: " prompt-file)))
    (lib/emit "CODEX_CRON_NAME" (or (:name job) (:id job)))
    (lib/emit "CODEX_CRON_PROMPT_FILE" (str prompt-file))
    (lib/emit "CODEX_CRON_WORKDIR" (:workdir job))
    (lib/emit "CODEX_CRON_OUTPUT_ROOT" (:output-root job))
    (lib/emit "CODEX_CRON_RUNNER" (:runner job))
    (lib/emit "CODEX_CRON_MODEL" (:model job))
    (lib/emit "CODEX_CRON_PROFILE" (:profile job))
    (lib/emit "CODEX_CRON_BYPASS_APPROVALS" (str (get job :bypass-approvals true)))
    (lib/emit "CODEX_CRON_EXTRA_ARGS" (:extra-args job))))
