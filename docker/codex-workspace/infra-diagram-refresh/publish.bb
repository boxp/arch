#!/usr/bin/env bb
;; 監査した agent が両図とサムネイルを作り直して配備する手順。vault の正本と配信中の Worker は、検査と配備の確認が通るまで置き換えない。
;; usage: publish.bb prepare-tools | stage BOXP-N | build BOXP-N | check-html FILE lineage|architecture | deploy BOXP-N | promote BOXP-N
(require '[babashka.fs :as fs]
         '[babashka.process :refer [shell]]
         '[cheshire.core :as json]
         '[clojure.edn :as edn]
         '[clojure.string :as str])

(def here (str (fs/parent (fs/absolutize *file*))))
(def repo "boxp/arch")
(defn env [k d] (or (System/getenv k) d))
(defn vault [] (env "CODEX_TASK_BOARD_VAULT" "/home/boxp/Documents/obsidian-headless/BOXP"))
(defn cache-root [] (env "INFRA_DIAGRAM_REFRESH_CACHE" (str (fs/path (System/getProperty "user.home") ".cache/infra-diagram-refresh"))))
(defn tools-dir [] (env "BROWSER_TOOLS" (str (fs/path (cache-root) "browser-tools"))))
(defn stage-dir [ticket] (str (fs/path (cache-root) "staging" ticket)))
(defn rules [] (edn/read-string (slurp (env "INFRA_DIAGRAM_REFRESH_RULES" (str here "/rules.edn")))))
(defn die [& xs] (binding [*out* *err*] (println (str/join " " xs))) (System/exit 1))

(def diagrams
  [{:id "lineage" :project "lolice-infrastructure-lineage" :html "lolice-lineage.html"
    :env "lolice-lineage-deploy" :secret "LOLICE_LINEAGE_HTML_XZ_B64" :workflow "deploy-lolice-lineage.yml"}
   {:id "architecture" :project "lolice-infrastructure-architecture" :html "lolice-architecture.html"
    :env "lolice-architecture-deploy" :secret "LOLICE_ARCHITECTURE_HTML_XZ_B64" :workflow "deploy-lolice-architecture.yml"}])

(defn sh
  "失敗したら止める。stderr に秘密が混ざる呼び方はしないが、出力は必要なものだけ返す。"
  [opts & args]
  (let [r (apply shell (merge {:out :string :err :string :continue true} opts) args)]
    (when-not (zero? (:exit r))
      ;; docker pull の進捗などで原因が流れないよう、末尾だけ出す
      (die "failed:" (first args) (second args) (str/join "\n" (take-last 15 (str/split-lines (str (:err r)))))))
    (str/trim (str (:out r)))))

(defn sha256-file [path] (first (str/split (sh {} "sha256sum" (str path)) #"\s+")))
(defn manifest-path [ticket] (str (fs/path (stage-dir ticket) "manifest.edn")))
(defn manifest [ticket]
  (if (fs/exists? (manifest-path ticket))
    (edn/read-string (slurp (manifest-path ticket)))
    (die "not staged:" ticket)))
(defn save-manifest! [ticket m]
  (spit (str (manifest-path ticket) ".tmp") (pr-str m))
  (fs/move (str (manifest-path ticket) ".tmp") (manifest-path ticket) {:replace-existing true :atomic-move true}))

;; ── 道具
(defn cmd-prepare-tools []
  (let [t (tools-dir) pw (str (fs/path t "pw")) fonts (str (fs/path t "fonts"))]
    (fs/create-dirs pw)
    (fs/create-dirs fonts)
    (when-not (fs/exists? (fs/path pw "node_modules/playwright"))
      (sh {:dir pw} "npm" "install" "--no-save" "--silent" "playwright@1.56.1"))
    (doseq [n ["NotoSansCJKjp-Regular.otf" "NotoSansCJKjp-Bold.otf"]
            :let [f (str (fs/path fonts n))]]
      (when-not (fs/exists? f)
        (sh {} "curl" "-fsSL" "-m" "300" "-o" f
            (str "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/Japanese/" n))))
    (println "tools ready:" t)))

;; ── staging
(defn clone! [name dest]
  (sh {} "git" "clone" "-q" "--depth" "1" (str "https://github.com/" name ".git") dest)
  (sh {:dir dest} "git" "rev-parse" "HEAD"))

(defn collect-snapshot!
  "live の取得に失敗すれば staging ごと止める。実行ログ由来の model 経路は自動で集めないので、前回の値を引き継ぐ。"
  [dest previous]
  (let [tmp (str dest ".tmp")]
    (sh {} (env "INFRA_DIAGRAM_REFRESH_COLLECT_LIVE" (str here "/collect-live.sh")) tmp)
    (let [snap (json/parse-string (slurp tmp) true)
          prev (json/parse-string (slurp (str previous)) true)]
      (spit dest (json/generate-string (assoc snap :runtime_routes (:runtime_routes prev)) {:pretty true}))
      (fs/delete tmp))))

(defn cmd-stage [ticket]
  (let [dir (stage-dir ticket) projects (str (fs/path dir "Projects"))]
    (when (fs/exists? dir) (fs/delete-tree dir))
    (fs/create-dirs projects)
    (let [arch (str (fs/path dir "arch")) lolice (str (fs/path dir "lolice"))
          arch-sha (clone! "boxp/arch" arch)
          lolice-sha (clone! "boxp/lolice" lolice)
          bases (into {} (for [{:keys [id project html]} diagrams]
                           [id (sha256-file (fs/path (vault) "Projects" project html))]))]
      (doseq [{:keys [project]} diagrams
              :let [src (fs/path (vault) "Projects" project) dst (fs/path projects project)]]
        (fs/create-dirs dst)
        (doseq [e (fs/list-dir src)
                :when (not (#{"previous" "previews"} (fs/file-name e)))]
          ;; copy-tree はファイルを受けない
          (if (fs/directory? e)
            (fs/copy-tree e (fs/path dst (fs/file-name e)) {:replace-existing true})
            (fs/copy e (fs/path dst (fs/file-name e)) {:replace-existing true}))))
      (doseq [{:keys [id project]} diagrams]
        (collect-snapshot! (str (fs/path projects project "data/live-snapshot.json"))
                           (fs/path (vault) "Projects" project "data/live-snapshot.json")))
      (save-manifest! ticket {:ticket ticket :arch-sha arch-sha :lolice-sha lolice-sha :bases bases :built nil :deployed {}})
      (println "staged" dir "arch" arch-sha "lolice" lolice-sha))))

;; ── 検査
(defn html-problems
  "公開境界と Owner の指定を機械で確かめる。意味の判断は agent が行う。"
  [r id text]
  (concat
   (for [p (concat (:forbidden-html-patterns r) (:secret-html-patterns r))
         :when (re-find (re-pattern p) text)]
     (str id ": 含んではいけない表現 /" p "/"))
   (for [p (get-in r [:required-html-patterns id])
         :when (not (re-find (re-pattern p) text))]
     (str id ": 必須の表記がない /" p "/"))))

(defn cmd-check-html [path id]
  (let [problems (html-problems (rules) id (slurp path))]
    (run! println problems)
    (when (seq problems) (System/exit 1))
    (println "OK" id)))

(defn browser-env []
  {"BROWSER_TOOLS" (tools-dir)
   "PW_MODULES" (str (fs/path (tools-dir) "pw/node_modules"))
   "FONTS" (str (fs/path (tools-dir) "fonts"))})

(defn run-browser! [project-dir script html out]
  (sh {:dir project-dir :extra-env (browser-env) :out :inherit}
      "tools/run-browser.sh" script html out))

(defn cmd-build [ticket]
  (let [m (manifest ticket) dir (stage-dir ticket)
        project #(str (fs/path dir "Projects" %))
        build-env {"ARCH_DIR" (str (fs/path dir "arch")) "LOLICE_DIR" (str (fs/path dir "lolice"))}
        arch-tools (project "lolice-infrastructure-architecture")
        thumbs (str (fs/path dir "thumbnails"))]
    ;; lineage を先に作る。architecture は lineage の関係だけを束ねる。
    (doseq [{:keys [project] :as d} diagrams]
      (sh {:dir (str (fs/path dir "Projects" project)) :extra-env build-env :out :inherit} "bb" "tools/build.bb"))
    (let [hashes
          (into {}
                (for [{:keys [id project html]} diagrams
                      :let [pdir (str (fs/path dir "Projects" project))
                            file (str (fs/path pdir html))
                            problems (html-problems (rules) id (slurp file))]]
                  (do (when (seq problems) (run! println problems) (die "policy check failed:" id))
                      (run-browser! pdir (str pdir "/tools/browser-check.mjs") file (str (fs/path dir "browser" id)))
                      ;; サムネイルは実 HTML の実画面から作る。絵は足さない。
                      (run-browser! arch-tools (str arch-tools "/tools/make-thumbnail.mjs") file thumbs)
                      [id (sha256-file file)])))]
      (doseq [n ["lolice-lineage.webp" "lolice-architecture.webp"]]
        (let [f (fs/path thumbs n) b (fs/read-all-bytes f)]
          ;; stage の workflow は 2 分割まで受ける (40,000 文字 x 2)
          (when (or (< (alength b) 5000) (> (alength b) 58000))
            (die "thumbnail size out of range:" n (alength b)))))
      (save-manifest! ticket (assoc m :built hashes :deployed {} :verified false))
      (println "built" hashes))))

;; ── 配備
(defn run-active? [workflow]
  (seq (json/parse-string
        (sh {} "gh" "run" "list" "-R" repo "--workflow" workflow "--limit" "5"
            "--json" "status" "--jq" "[.[]|select(.status!=\"completed\")]")
        true)))

(defn dispatch-and-wait! [workflow & fields]
  (when (run-active? workflow) (die "another run is active:" workflow "(少し待って deploy をやり直す)"))
  (let [before (str (java.time.Instant/now))]
    (apply sh {} "gh" "workflow" "run" workflow "-R" repo "--ref" "main" (mapcat (fn [f] ["-f" f]) fields))
    (let [id (loop [n 0]
               (Thread/sleep 5000)
               (let [found (str/trim
                            (sh {} "gh" "run" "list" "-R" repo "--workflow" workflow "--event" "workflow_dispatch"
                                "--limit" "5" "--json" "databaseId,createdAt"
                                "--jq" (str "[.[]|select(.createdAt>=\"" (subs before 0 19) "Z\")]|sort_by(.createdAt)|last|.databaseId // empty")))]
                 (cond (seq found) found
                       (> n 24) (die "dispatched run not found:" workflow)
                       :else (recur (inc n)))))]
      (let [r (shell {:continue true :out :string :err :string} "gh" "run" "watch" id "-R" repo "--exit-status" "--interval" "20")]
        (when-not (zero? (:exit r)) (die "workflow failed:" workflow id "(前回の版を配信中)")))
      id)))

(defn set-parts!
  "1 個の secret は 48 KB まで。古い分割が混ざらないよう、余る番号は消す。値は stdin で渡し、引数に出さない。"
  [env-name base parts max-parts]
  (when (> (count parts) max-parts) (die "too many secret parts:" base (count parts)))
  (let [names (mapv #(if (= 1 %) base (str base "_" %)) (range 1 (inc max-parts)))
        wanted (set (take (count parts) names))]
    (doseq [[name value] (map vector names parts)]
      (sh {:in value} "gh" "secret" "set" name "-R" repo "--env" env-name))
    (doseq [name (remove wanted names)]
      ;; 無い secret の削除は失敗するので、結果は下の一覧で確かめる
      (shell {:continue true :out :string :err :string} "gh" "secret" "delete" name "-R" repo "--env" env-name))
    (let [listed (set (str/split-lines (sh {} "gh" "secret" "list" "-R" repo "--env" env-name "--json" "name" "--jq" ".[].name")))
          stale (filter #(and (listed %) (not (wanted %))) names)]
      (when (seq stale) (die "stale secret parts remain:" (str/join "," stale))))))

(defn delete-parts! [env-name base max-parts]
  (set-parts! env-name base [] max-parts))

(defn split-40k [s] (map #(apply str %) (partition-all 40000 s)))

(defn xz-b64 [path]
  (sh {} "bash" "-c" "xz -9e -c \"$0\" | base64 -w0" (str path)))

(defn deploy-page! [ticket {:keys [id project html env secret workflow]} sha]
  (let [file (fs/path (stage-dir ticket) "Projects" project html)
        parts (split-40k (xz-b64 file))]
    (when-not (= sha (sha256-file file)) (die "staged page changed after build:" id))
    (when (> (count parts) 4) (die "page too large for 4 secrets:" id))
    (when (run-active? workflow) (die "another run is active:" workflow))
    (try
      (set-parts! env secret parts 4)
      (dispatch-and-wait! workflow "mode=html" (str "expected_sha256=" sha))
      (finally (delete-parts! env secret 4)))))

(defn http-code [url]
  (sh {} "curl" "-sS" "-m" "20" "-o" "/dev/null" "-w" "%{http_code}" url))

(defn verify-boundaries!
  "配備後に公開境界を実 URL で確かめる。本文は表示しない。"
  [hashes]
  (let [body (sh {} "curl" "-fsS" "-m" "20" "https://lolice-lineage.b0xp.io/sha256")]
    (when-not (str/includes? body (get hashes "lineage")) (die "lineage hash mismatch on the live URL")))
  (doseq [u ["https://lolice-architecture.b0xp.io/" "https://portfolio-stage.b0xp.io/"]]
    (when-not (= "302" (http-code u)) (die "anonymous access is not redirected:" u)))
  (when (str/includes? (sh {} "curl" "-fsSL" "-m" "20" "https://b0xp.io/") "lolice-architecture")
    (die "production portfolio mentions the private diagram")))

(defn cmd-deploy [ticket]
  (let [m (manifest ticket) hashes (:built m)]
    (when-not hashes (die "not built:" ticket))
    (doseq [{:keys [id] :as d} diagrams]
      (when-not (= (get hashes id) (get-in (manifest ticket) [:deployed id]))
        (let [run (deploy-page! ticket d (get hashes id))]
          (save-manifest! ticket (assoc-in (manifest ticket) [:deployed id] (get hashes id)))
          (println "deployed" id "run" run))))
    ;; 全体図のサムネイルは public repo に置けないので secret で渡す。lineage のものは基準更新の PR に入れる。
    (let [thumb (fs/path (stage-dir ticket) "thumbnails/lolice-architecture.webp")
          b64 (.encodeToString (java.util.Base64/getEncoder) (fs/read-all-bytes thumb))
          thumb-sha (sha256-file thumb)]
      (set-parts! "portfolio-stage-private" "LOLICE_ARCHITECTURE_THUMBNAIL_B64" (split-40k b64) 2)
      (let [run (dispatch-and-wait! "deploy-portfolio.yml")
            log (sh {} "gh" "run" "view" run "-R" repo "--log")]
        (when-not (str/includes? log thumb-sha) (die "stage thumbnail hash not found in run" run))
        (println "stage deployed run" run "thumbnail" thumb-sha)
        (save-manifest! ticket (assoc (manifest ticket) :thumbnail-sha thumb-sha :stage-run run))))
    (verify-boundaries! hashes)
    (save-manifest! ticket (assoc (manifest ticket) :verified true))
    (println "deploy verified")))

;; ── 正本の更新
(defn cmd-promote [ticket]
  (let [m (manifest ticket) stamp (str/replace (subs (str (java.time.Instant/now)) 0 19) #"[-:]" "")]
    (doseq [{:keys [id]} diagrams]
      (when-not (and (:verified m) (get-in m [:built id]) (= (get-in m [:built id]) (get-in m [:deployed id])))
        (die "not deployed and verified:" id)))
    (doseq [{:keys [id project html]} diagrams
            :let [src (fs/path (stage-dir ticket) "Projects" project)
                  dst (fs/path (vault) "Projects" project)
                  now-sha (sha256-file (fs/path dst html))
                  target (get-in m [:built id])]]
      ;; 別の作業が正本を変えていたら上書きしない。やり直しは許す。
      (when-not (#{(get-in m [:bases id]) target} now-sha)
        (die "vault page changed since stage, stage again:" id))
      (when-not (= now-sha target)
        (let [prev (fs/path dst "previous" (str stamp "-" (subs now-sha 0 8)))]
          (fs/create-dirs prev)
          (fs/copy (fs/path dst html) (fs/path prev html))
          (fs/copy-tree (fs/path dst "data") (fs/path prev "data")))
        (doseq [sub ["data" "src" "tools"]
                :when (fs/exists? (fs/path src sub))]
          (fs/copy-tree (fs/path src sub) (fs/path dst sub) {:replace-existing true}))
        (fs/copy (fs/path src html) (str (fs/path dst html) ".tmp") {:replace-existing true})
        (fs/move (str (fs/path dst html) ".tmp") (fs/path dst html) {:replace-existing true :atomic-move true})))
    (let [previews (fs/path (vault) "Projects/lolice-infrastructure-architecture/previews/portfolio-thumbnails")]
      (fs/create-dirs previews)
      (doseq [n ["lolice-lineage.webp" "lolice-architecture.webp"]]
        (fs/copy (fs/path (stage-dir ticket) "thumbnails" n) (fs/path previews n) {:replace-existing true})))
    (let [refresh (str here "/refresh.bb")
          snap (str (fs/path (stage-dir ticket) "Projects/lolice-infrastructure-lineage/data/live-snapshot.json"))]
      (sh {} "bb" refresh "live-candidate" snap)
      (sh {} "bb" refresh "mark-published" ticket))
    (println "promoted" ticket)))

(when (= *file* (System/getProperty "babashka.file"))
  (let [[cmd a b] *command-line-args*]
    (case cmd
      "prepare-tools" (cmd-prepare-tools)
      "stage" (cmd-stage a)
      "build" (cmd-build a)
      "check-html" (cmd-check-html a b)
      "deploy" (cmd-deploy a)
      "promote" (cmd-promote a)
      (do (println "usage: publish.bb prepare-tools | stage BOXP-N | build BOXP-N | check-html FILE lineage|architecture | deploy BOXP-N | promote BOXP-N")
          (System/exit 2)))))
