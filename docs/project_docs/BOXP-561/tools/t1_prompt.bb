#!/usr/bin/env bb
;; BOXP-561 T1: 本番 runner の prompt-for を scratch vault/root で呼び、localllm-coder と同じ prompt を作る。
;; usage: CODEX_TASK_BOARD_VAULT=SCRATCH_VAULT CODEX_TASK_BOARD_ROOT=SCRATCH_ROOT t1_prompt.bb TICKET WORKSPACE_DIR REPO_PATH OUT
(require '[clojure.string :as str])
(let [[ticket wsdir repo out] *command-line-args*
      v (System/getenv "CODEX_TASK_BOARD_VAULT") r (System/getenv "CODEX_TASK_BOARD_ROOT")]
  (when-not (and out (str/includes? (str v) "/BOXP-561/") (str/includes? (str r) "/BOXP-561/"))
    (binding [*out* *err*] (println "usage: scratch CODEX_TASK_BOARD_VAULT/ROOT under BOXP-561 workspace; t1_prompt.bb TICKET WSDIR REPO OUT")) (System/exit 2))
  (load-file "/opt/codex-workspace/task-board/task_board_runner.bb")
  (let [ws {:workspace-dir wsdir :repo-worktrees [{:repo "boxp/arch" :path repo :branch "eval561-t1"}]}
        ;; run-localllm-coder! と同じ組み立て（task_board_runner.bb run-localllm-coder! の prompt 部分）
        p (str ((resolve 'prompt-for) :implement ticket "In Progress" ws "localllm-coder" nil)
               "\nYou are a local model. Work only inside the workspace repositories. Run relevant tests. Do not git push or commit or create PRs. Do not run codex, claude, delegate.py or any other agent / cloud CLI. End with a TASK_BOARD_RESULT marker.\n")]
    (spit out p) (println "prompt chars=" (count p))))
