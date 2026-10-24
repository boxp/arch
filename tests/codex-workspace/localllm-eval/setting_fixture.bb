#!/usr/bin/env bb

;; Creative-setting corpus fixture for the BOXP-277 owner purpose: "read many
;; setting notes of a fictional universe, then draft a NEW setting into another
;; note as an unapproved proposal". Everything here is invented for the test and
;; deliberately non-explicit (no real owner material, no adult content); the
;; shape mirrors a real setting vault: world notes, a timeline, several
;; characters with similar names, a retcon decision, a rejected idea,
;; unapproved drafts, and (scale M) unrelated notes with overlapping words.
;;
;; Layout
;;   pilot/setting/characters/yui.md         write target (P01/P03/P05/P06/P08): canon of 篝火ユイ
;;   pilot/setting/characters/yuki.md        write target (P04): canon of 篝火ユキ (the sister)
;;   pilot/setting/relationships.md          write target (P02/P07)
;;   pilot/setting/world/*.md                written in P09 (new note)
;;   refs/setting/world/{overview,lantern-craft,festivals,timeline,locations}.md
;;   refs/setting/characters/{mio,mina,ren,obaa}.md   other characters
;;   refs/setting/characters/yui-v1.md       superseded profile (age 17) — not canon
;;   refs/setting/decisions/*.md             採用 retcon (Yui 17→19), 却下 idea (Ren childhood friend)
;;   refs/setting/proposals/*.md             未承認 drafts (Mio is Mina's sister; Yuki can use lantern craft)
;;   refs/setting/unrelated/**               scale M padding (40 notes) incl. a decoy "ユイ" who is a cook
;;
;; Usage: bb setting_fixture.bb <dir> [--scale S|M]
;;
;; Canon facts a proposal must respect (used by setting_cases.edn):
;;   Yui: 19 (retcon, decision 2026-03; v1 said 17), lantern-craft user, tone 「〜だぜ」「任せろ」,
;;        costume 藍の外套 + 橙の帯, born 灯暦 101, public.
;;   Yuki: 22, Yui's older sister, cannot use lantern craft (draft says otherwise = unapproved),
;;        tone 「〜ですわ」「ごきげんよう」, costume 白地に銀糸.
;;   Mio: 18, bell-tower apprentice since 119, tone 「…です」「あの、」; NOT Mina's sister (unapproved draft).
;;   Mina: 25, traveling merchant, tone 「まいど」; a different person from Mio.
;;   Ren: 20, arrived in 灯暦 118 (timeline); the "childhood friend of Yui" idea was 却下.
;;   Festivals: 宵祭り (summer, lantern succession), 霜灯祭 (winter; traditional colours 藍と白).
;;   Now: 灯暦 120.

(require '[babashka.fs :as fs] '[babashka.process :as p] '[clojure.string :as str])

(def args (vec *command-line-args*))
(def target (or (first args) (do (println "usage: setting_fixture.bb <dir> [--scale S|M]") (System/exit 2))))
(defn arg [flag default] (let [i (.indexOf args flag)] (if (>= i 0) (nth args (inc i)) default)))
(def scale (arg "--scale" "S"))

(def here (str (fs/parent (fs/canonicalize *file*))))
(let [r @(p/process ["bb" (str (fs/path here "fixture.bb")) target] {:out :string :err :string})]
  (when-not (zero? (:exit r)) (throw (ex-info (str "fixture.bb failed: " (:err r)) {}))))

(defn write! [rel content]
  (let [p (fs/path target rel)]
    (fs/create-dirs (fs/parent p))
    (spit (str p) content)))

(def pilot "Projects/task-board-localllm-docs/pilot/setting")
(def refs "Projects/task-board-localllm-docs/refs/setting")

;; ---------------------------------------------------------------------------
;; Write targets (canon notes that receive the proposal section)
;; ---------------------------------------------------------------------------

(write! (str pilot "/characters/yui.md")
        (str "---\ntitle: 篝火ユイ\ntype: character\nvisibility: public\nupdated: 2026-03-10\n---\n\n"
             "# 篝火ユイ（かがりび ユイ）\n\n"
             "## 基本情報\n\n"
             "- 年齢: 19 歳（灯暦 101 年生まれ。[[Projects/task-board-localllm-docs/refs/setting/decisions/2026-03-yui-age-retcon|2026-03 の設定変更]] で 17 歳から改定）\n"
             "- 役割: 灯火街の灯火術師。年に一度の [[Projects/task-board-localllm-docs/refs/setting/world/festivals|宵祭り]] で街の大灯籠に灯を継ぐ役目を持つ。\n"
             "- 家族: 姉の [[Projects/task-board-localllm-docs/pilot/setting/characters/yuki|篝火ユキ]]。\n\n"
             "## 口調・性格\n\n"
             "- 快活で前向き。一人称は「あたし」、語尾は「〜だぜ」「任せろ」。目上にも砕けた口調だが、灯火術の話になると真剣になる。\n\n"
             "## 衣装・外見\n\n"
             "- 藍色の外套に橙色の帯。髪は短く、灯籠の火に映える赤茶色。\n"
             "- 腰に小さな手提げ灯籠を下げている（灯火術の媒介）。\n\n"
             "## 関係性\n\n"
             "- [[Projects/task-board-localllm-docs/refs/setting/characters/ren|鐘守レン]] とは灯暦 118 年に出会った相棒。詳細は [[Projects/task-board-localllm-docs/pilot/setting/relationships|関係性]] を参照。\n\n"
             "## 備考\n\n"
             "- 公開範囲: 公開。\n"))

(write! (str pilot "/characters/yuki.md")
        (str "---\ntitle: 篝火ユキ\ntype: character\nvisibility: public\nupdated: 2026-02-01\n---\n\n"
             "# 篝火ユキ（かがりび ユキ）\n\n"
             "## 基本情報\n\n"
             "- 年齢: 22 歳。[[Projects/task-board-localllm-docs/pilot/setting/characters/yui|篝火ユイ]] の姉。\n"
             "- 役割: 灯火街の灯籠組合の事務方。灯火術は使えない（この点を変える案は [[Projects/task-board-localllm-docs/refs/setting/proposals/draft-yuki-lantern|未承認の下書き]] にあるが採用されていない）。\n\n"
             "## 口調・性格\n\n"
             "- 丁寧で落ち着いた口調。一人称は「わたくし」、語尾は「〜ですわ」、挨拶は「ごきげんよう」。妹には甘い。\n\n"
             "## 衣装・外見\n\n"
             "- 白地に銀糸の刺繍が入った長衣。髪は長く、夜空のような黒。\n\n"
             "## 備考\n\n"
             "- 公開範囲: 公開。\n"))

(write! (str pilot "/relationships.md")
        (str "---\ntitle: 灯火街 関係性\ntype: relationships\nupdated: 2026-04-01\n---\n\n"
             "# 灯火街 関係性\n\n"
             "## 篝火ユイ と 篝火ユキ\n\n"
             "- 姉妹。ユキは事務方としてユイの祭りの支度を支える。\n\n"
             "## 篝火ユイ と 鐘守レン\n\n"
             "- 灯暦 118 年、レンが灯火街に来た年の宵祭りで出会い、以後は相棒。幼馴染ではない（[[Projects/task-board-localllm-docs/refs/setting/decisions/2026-05-ren-origin|2026-05 の決定]] で却下）。\n\n"
             "## 水瀬ミオ と 灯守のばあさま\n\n"
             "- 鐘楼の師弟。ミオは灯暦 119 年から見習い。\n\n"
             "## 備考\n\n"
             "- 未承認の案（ミオとミナの姉妹説など）はここに書かない。[[Projects/task-board-localllm-docs/refs/setting/proposals/draft-mio-sister|下書き]] 参照。\n"))

;; ---------------------------------------------------------------------------
;; Read-only corpus
;; ---------------------------------------------------------------------------

(write! (str refs "/world/overview.md")
        (str "---\ntitle: 灯火街 概要\ntype: world\n---\n\n# 灯火街（ともしびがい）\n\n"
             "## 概要\n\n山あいの小さな街。夜になると街中の灯籠が [[Projects/task-board-localllm-docs/refs/setting/world/lantern-craft|灯火術]] で灯る。暦は「灯暦」で数え、現在は灯暦 120 年。\n\n"
             "## 主な人物\n\n- [[Projects/task-board-localllm-docs/pilot/setting/characters/yui|篝火ユイ]]（灯火術師）\n- [[Projects/task-board-localllm-docs/pilot/setting/characters/yuki|篝火ユキ]]（事務方）\n- [[Projects/task-board-localllm-docs/refs/setting/characters/mio|水瀬ミオ]]（鐘楼の見習い）\n- [[Projects/task-board-localllm-docs/refs/setting/characters/mina|水無瀬ミナ]]（行商人）\n- [[Projects/task-board-localllm-docs/refs/setting/characters/ren|鐘守レン]]（鐘守）\n- [[Projects/task-board-localllm-docs/refs/setting/characters/obaa|灯守のばあさま]]（鐘楼の長）\n\n"
             "## 資料\n\n- [[Projects/task-board-localllm-docs/refs/setting/world/timeline|年表]]\n- [[Projects/task-board-localllm-docs/refs/setting/world/festivals|祭り]]\n- [[Projects/task-board-localllm-docs/refs/setting/world/locations|場所]]\n- [[Projects/task-board-localllm-docs/pilot/setting/relationships|関係性]]\n"))

(write! (str refs "/world/lantern-craft.md")
        (str "---\ntitle: 灯火術\ntype: world\n---\n\n# 灯火術（とうかじゅつ）\n\n"
             "## 規則\n\n- 灯火術師は手提げ灯籠を媒介にして火を分ける。媒介を失うと術は使えない。\n- 火は水では消えず、術師が「返す」ことでのみ消える。\n- 術師は街に数人しかいない。篝火ユイはその一人。篝火ユキは術師ではない。\n\n"
             "## 継承\n\n- 年に一度の宵祭りで、術師が大灯籠に灯を継ぐ。継ぎ損ねると翌年まで街灯が弱くなる。\n"))

(write! (str refs "/world/festivals.md")
        (str "---\ntitle: 灯火街の祭り\ntype: world\n---\n\n# 灯火街の祭り\n\n"
             "## 宵祭り（よいまつり）\n\n- 夏。灯火術師が大灯籠に灯を継ぐ。街の人は橙色の提灯を持って歩く。\n\n"
             "## 霜灯祭（しもびまつり）\n\n- 冬。雪の中で灯籠を飾る祭り。伝統的な装いの色は藍と白で、銀糸の飾りを添える。術師は参加するが灯を継ぐ役目はない。\n- 祭りの夜、鐘楼の鐘が三度鳴る。\n"))

(write! (str refs "/world/timeline.md")
        (str "---\ntitle: 灯火街 年表\ntype: world\n---\n\n# 灯火街 年表（灯暦）\n\n"
             "| 年 | 出来事 |\n|---|---|\n"
             "| 98 | 篝火ユキ 生まれる |\n"
             "| 101 | 篝火ユイ 生まれる（2026-03 の設定変更で 103 年から改定） |\n"
             "| 102 | 水瀬ミオ 生まれる |\n"
             "| 95 | 水無瀬ミナ 生まれる（行商の家系、別の街の出身） |\n"
             "| 100 | 鐘守レン 生まれる（別の街） |\n"
             "| 116 | ユイが灯火術師として初めて灯を継ぐ |\n"
             "| 118 | 鐘守レンが灯火街に来る。宵祭りでユイと出会う |\n"
             "| 119 | 水瀬ミオが鐘楼の見習いになる |\n"
             "| 120 | 現在 |\n"))

(write! (str refs "/world/locations.md")
        (str "---\ntitle: 灯火街 場所\ntype: world\n---\n\n# 灯火街 場所\n\n"
             "## 鐘楼\n\n- 街の中央。灯守のばあさまが長を務め、水瀬ミオが見習い、鐘守レンが鐘を打つ。\n\n"
             "## 灯籠組合\n\n- 篝火ユキが事務方として働く。祭りの支度を取り仕切る。\n\n"
             "## 市場\n\n- 水無瀬ミナが月に一度行商に来る。\n"))

(write! (str refs "/characters/yui-v1.md")
        (str "---\ntitle: 篝火ユイ（旧版）\ntype: character\nstatus: superseded\n---\n\n# 篝火ユイ（旧版・改定前）\n\n"
             "> この版は 2026-03 の設定変更で置き換えられました。現在の設定は [[Projects/task-board-localllm-docs/pilot/setting/characters/yui|篝火ユイ]] を参照。\n\n"
             "## 基本情報（旧）\n\n- 年齢: 17 歳（灯暦 103 年生まれ）。\n- 口調: 「〜だぜ」。\n- 衣装: 藍色の外套に橙色の帯。\n"))

(write! (str refs "/characters/mio.md")
        (str "---\ntitle: 水瀬ミオ\ntype: character\nvisibility: public\n---\n\n# 水瀬ミオ（みなせ ミオ）\n\n"
             "## 基本情報\n\n- 年齢: 18 歳（灯暦 102 年生まれ）。灯暦 119 年から鐘楼の見習い。師は [[Projects/task-board-localllm-docs/refs/setting/characters/obaa|灯守のばあさま]]。\n- 家族: 両親と灯火街に住む。兄弟姉妹はいない（「水無瀬ミナの妹」という案は [[Projects/task-board-localllm-docs/refs/setting/proposals/draft-mio-sister|未承認]]）。\n\n"
             "## 口調・性格\n\n- 控えめで丁寧。語尾は「…です」、話し始めに「あの、」と付く。鐘の音が好き。\n\n"
             "## 衣装・外見\n\n- 鈍色の作業着に鐘楼の紋。髪は肩まで、栗色。\n"))

(write! (str refs "/characters/mina.md")
        (str "---\ntitle: 水無瀬ミナ\ntype: character\nvisibility: public\n---\n\n# 水無瀬ミナ（みなせ ミナ）\n\n"
             "## 基本情報\n\n- 年齢: 25 歳（灯暦 95 年生まれ）。別の街の出身の行商人で、月に一度灯火街の市場に来る。\n- 水瀬ミオとは姓の読みが同じだが別人で、血縁はない。\n\n"
             "## 口調・性格\n\n- 商人口調。「まいど」「お安くしとくよ」。陽気で押しが強い。\n\n"
             "## 衣装・外見\n\n- 旅装に大きな背負い籠。\n"))

(write! (str refs "/characters/ren.md")
        (str "---\ntitle: 鐘守レン\ntype: character\nvisibility: public\n---\n\n# 鐘守レン（かねもり レン）\n\n"
             "## 基本情報\n\n- 年齢: 20 歳（灯暦 100 年生まれ、別の街の出身）。灯暦 118 年に灯火街へ来て鐘楼の鐘守になった。\n- 篝火ユイとは 118 年の宵祭りで出会った相棒。幼馴染という案は [[Projects/task-board-localllm-docs/refs/setting/decisions/2026-05-ren-origin|却下]] されている。\n\n"
             "## 口調・性格\n\n- 無口。「…ああ」「悪くない」。必要なことしか言わないが面倒見はよい。\n\n"
             "## 衣装・外見\n\n- 黒い半纏に鐘の紋。背が高い。\n"))

(write! (str refs "/characters/obaa.md")
        (str "---\ntitle: 灯守のばあさま\ntype: character\nvisibility: public\n---\n\n# 灯守のばあさま\n\n"
             "## 基本情報\n\n- 鐘楼の長。本名は設定されていない。水瀬ミオの師。\n\n## 口調・性格\n\n- ゆっくりとした老人口調。「〜じゃよ」。\n"))

(write! (str refs "/decisions/2026-03-yui-age-retcon.md")
        (str "---\ntitle: 2026-03 設定変更: 篝火ユイの年齢\nstatus: 採用\ndate: 2026-03-10\n---\n\n# 2026-03 設定変更: 篝火ユイの年齢を 17 歳から 19 歳に\n\n"
             "## 決定\n\n**採用**。篝火ユイの年齢を 17 歳から 19 歳に変更し、生年を灯暦 103 年から 101 年に改める。旧版 [[Projects/task-board-localllm-docs/refs/setting/characters/yui-v1|篝火ユイ（旧版）]] は superseded。\n\n"
             "## 理由\n\n- 灯暦 116 年に初めて灯を継いだ時点で 15 歳になるようにするため。\n"))

(write! (str refs "/decisions/2026-05-ren-origin.md")
        (str "---\ntitle: 2026-05 検討: 鐘守レンをユイの幼馴染にする\nstatus: 却下\ndate: 2026-05-02\n---\n\n# 2026-05 検討: 鐘守レンをユイの幼馴染にする\n\n"
             "## 決定\n\n**却下**。レンは灯暦 118 年に別の街から来た設定を維持する。ユイとの出会いは 118 年の宵祭り。\n"))

(write! (str refs "/proposals/draft-mio-sister.md")
        (str "---\ntitle: 下書き: 水瀬ミオは水無瀬ミナの妹\nstatus: 未承認\ndate: 2026-06-01\n---\n\n# 下書き（未承認）: 水瀬ミオは水無瀬ミナの妹\n\n"
             "> 未承認の案。canon ではありません。\n\n- ミオとミナを生き別れの姉妹にする案。年表と矛盾する（出身の街が違う）ため保留。\n"))

(write! (str refs "/proposals/draft-yuki-lantern.md")
        (str "---\ntitle: 下書き: 篝火ユキも灯火術を使える\nstatus: 未承認\ndate: 2026-07-01\n---\n\n# 下書き（未承認）: 篝火ユキも灯火術を使える\n\n"
             "> 未承認の案。canon ではありません。\n\n- ユキに隠れた灯火術の才能がある案。灯火術ノートの「術師は数人」と整合させる必要があり未決。\n"))

(write! (str refs "/index.md")
        (str "---\ntitle: 灯火街 設定 index\n---\n\n# 灯火街 設定 index\n\n"
             "- 世界観: [[Projects/task-board-localllm-docs/refs/setting/world/overview|概要]]、[[Projects/task-board-localllm-docs/refs/setting/world/lantern-craft|灯火術]]、[[Projects/task-board-localllm-docs/refs/setting/world/festivals|祭り]]、[[Projects/task-board-localllm-docs/refs/setting/world/timeline|年表]]、[[Projects/task-board-localllm-docs/refs/setting/world/locations|場所]]\n"
             "- 人物: [[Projects/task-board-localllm-docs/pilot/setting/characters/yui|篝火ユイ]]、[[Projects/task-board-localllm-docs/pilot/setting/characters/yuki|篝火ユキ]]、[[Projects/task-board-localllm-docs/refs/setting/characters/mio|水瀬ミオ]]、[[Projects/task-board-localllm-docs/refs/setting/characters/mina|水無瀬ミナ]]、[[Projects/task-board-localllm-docs/refs/setting/characters/ren|鐘守レン]]、[[Projects/task-board-localllm-docs/refs/setting/characters/obaa|灯守のばあさま]]\n"
             "- 決定: decisions/（採用・却下）\n- 未承認の下書き: proposals/\n"))

;; ---------------------------------------------------------------------------
;; Scale M padding: unrelated notes sharing words (灯, 祭り, 衣装, ユイ ...)
;; ---------------------------------------------------------------------------

(def scales {"S" 0 "M" 40})
(def topics ["旅行記" "買い物メモ" "読書メモ" "料理レシピ" "観劇メモ" "写真整理" "工作日誌" "庭いじり"])
(doseq [n (range (get scales scale 0))]
  (let [topic (nth topics (mod n (count topics)))
        name (format "memo-%02d" n)]
    (write! (str refs "/unrelated/" topic "/" name ".md")
            (str "---\ntitle: " topic " " name "\n---\n\n# " topic " " name "\n\n"
                 "## 本文\n\n"
                 (case (mod n 4)
                   0 "- 近所の祭りで藍色の提灯を買った。衣装は白いシャツ。灯火街の話ではない。\n"
                   1 "- 料理人のユイさん（友人、灯火街の篝火ユイとは無関係）のレシピ: 橙を使った煮込み。17 歳の娘さんがいる。\n"
                   2 "- 読んだ本: 冬の祭りと鐘の音についての随筆。銀糸の刺繍の写真が良かった。\n"
                   "- 庭の灯籠を直した。灯火術ではなく普通のろうそく。\n")
                 (apply str (for [k (range 1 4)] (str "- この行は fixture の padding " k " です（" topic "）。設定資料ではありません。\n")))))))

(println (str "setting fixture written to " target " (scale " scale ", padding " (get scales scale 0) ")"))
