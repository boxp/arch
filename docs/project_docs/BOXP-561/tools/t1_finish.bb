#!/usr/bin/env bb
;; BOXP-561 T1 後段: pi 実行の記録(events.jsonl/meta.json)に本番 runner の結果処理関数
;; (localllm-coder-events / result-marker / localllm-coder-result) をそのまま当て、
;; runner が出す結果 (owner-acceptance / blocked) を判定する。owner-acceptance かつ
;; 固定検証 (verify.json) が accepted の時だけ、Owner 受入の代わりとして scratch vault の票を
;; task-board.bb update --lane Done で Done へ動かし、移動後の Board を読み戻して確認する。
;; GPU は使わないので、過去の T1 記録にも同じ判定を後から当てられる。
;; 本番 runner の tick そのもの（lock、プロセス起動、idle timeout、PR gate）は再現しない。
;; usage: t1_finish.bb RUNDIR   (RUNDIR/out/{events.jsonl,meta.json,verify.json} と RUNDIR/vault が必要)
(require '[babashka.fs :as fs] '[babashka.process :as p] '[cheshire.core :as j] '[clojure.string :as str])
(def tb (str (fs/expand-home "~/.claude/skills/obsidian-task-board/bin/task-board.bb")))
(let [[run] *command-line-args*
      out (some-> run (fs/path "out"))
      vault (some-> run (fs/path "vault"))]
  (when-not (and run (str/includes? (str (fs/canonicalize run)) "/BOXP-561/")
                 (every? #(fs/exists? (fs/path out %)) ["events.jsonl" "meta.json" "verify.json"])
                 (fs/exists? (fs/path vault "Boards" "Task Board.md")))
    (binding [*out* *err*] (println "usage: t1_finish.bb RUNDIR (BOXP-561 workspace 内、out/events.jsonl meta.json verify.json と vault/ が必要)"))
    (System/exit 2))
  (load-file "/opt/codex-workspace/task-board/task_board_runner.bb")
  (let [meta (j/parse-string (slurp (str (fs/path out "meta.json"))) true)
        verify (j/parse-string (slurp (str (fs/path out "verify.json"))) true)
        model (:model meta)
        exit (:exit-code meta)
        parsed ((resolve 'localllm-coder-events) (str/split-lines (slurp (str (fs/path out "events.jsonl")))))
        fallback? (or (empty? (:models-seen parsed)) (boolean (some #(not= model %) (:models-seen parsed))))
        marker ((resolve 'result-marker) (:last-message parsed))
        result ((resolve 'localllm-coder-result) (or exit 1) marker fallback?)
        accepted (true? (:accepted verify))
        move? (and (= "owner-acceptance" result) accepted)
        bpath (str (fs/path vault "Boards" "Task Board.md"))
        ;; 区間 1-10 の scratch Board には Done レーンが無かったので、再判定時は空の Done レーンを足す
        _ (when (and move? (not (re-find #"(?m)^## Done\s*$" (slurp bpath)))) (spit bpath "\n## Done\n" :append true))
        moved (when move?
                (p/shell {:continue true :out :string :err :string}
                         "bb" tb "update" "EVAL561-T1" "--vault" (str vault) "--lane" "Done"))
        board (slurp (str (fs/path vault "Boards" "Task Board.md")))
        done-lane (some-> (re-find #"(?s)## Done\n(.*?)(?:\n## |\z)" board) second)
        in-done (boolean (and done-lane (str/includes? done-lane "EVAL561-T1")))
        summary {:model model :exit-code exit :runner-marker marker :models-seen (:models-seen parsed) :fallback fallback?
                 :runner-result result :verify-accepted accepted
                 :done-move-attempted move? :done-move-exit (some-> moved :exit)
                 :card-in-done in-done
                 ;; 完走 = runner が受入へ回す結果を出し、固定検証に通り、票が実際に Done にある
                 :completed (and move? (zero? (or (:exit moved) 1)) in-done)}]
    (spit (str (fs/path out "finish.json")) (j/generate-string summary {:pretty true}))
    (println (j/generate-string summary))
    (System/exit (if (or (not move?) (:completed summary)) 0 1))))
