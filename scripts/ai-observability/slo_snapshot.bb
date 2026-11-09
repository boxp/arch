#!/usr/bin/env bb
(require '[babashka.fs :as fs])
(load-file (str (fs/path (fs/parent (fs/parent (fs/parent (fs/absolutize *file*)))) "docker/codex-workspace/task-board/ai_ops_slo.bb")))
(refer 'ai-ops-slo)
(when (= *file* (System/getProperty "babashka.file"))
  (apply ai-ops-slo/-main *command-line-args*))
