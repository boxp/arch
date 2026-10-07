#!/usr/bin/env bb
;; BOXP-217: lolice cluster / 周辺インフラの月次セキュリティ診断 (read-only 収集)
;;
;; 使い方:
;;   bb scripts/security-audit/security_audit.bb [--out report.md] [--arch-root PATH]
;;        [--skip-github] [--skip-kev] [--kev-file PATH] [--trivy] [--images-out PATH]
;;        [--repos owner/a,owner/b] [--all-advisories]
;;
;; 前提: kubectl (read-only), gh (repo:security_events 読み取り可), curl, jq 不要。
;; 出力は Markdown。Secret 本文・credential・Node の内部 IP は出力しない。
(ns security-audit
  (:require [babashka.process :as p]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

;; ---------------------------------------------------------------- helpers

(def trivy-env
  ;; trivy 0.75 の既定 DB ソース先頭 (mirror.gcr.io) は codex-workspace から到達不能なので ghcr.io を既定にする。
  (cond-> {}
    (nil? (System/getenv "TRIVY_DB_REPOSITORY")) (assoc "TRIVY_DB_REPOSITORY" "ghcr.io/aquasecurity/trivy-db:2")
    (nil? (System/getenv "TRIVY_JAVA_DB_REPOSITORY")) (assoc "TRIVY_JAVA_DB_REPOSITORY" "ghcr.io/aquasecurity/trivy-java-db:1")))

(defn sh
  "コマンドを実行し {:exit :out :err} を返す。失敗しても例外を投げない。"
  [& args]
  (let [r @(p/process args {:out :string :err :string :extra-env trivy-env})]
    {:exit (:exit r) :out (:out r) :err (:err r)}))

(defn sh-json [& args]
  (let [{:keys [exit out err]} (apply sh args)]
    (if (zero? exit)
      (json/parse-string out true)
      {::error (str "exit=" exit " " (str/trim (or err "")))})))

(defn err? [x] (and (map? x) (contains? x ::error)))

(defn kubectl-json [& args]
  (apply sh-json "kubectl" (concat args ["-o" "json"])))

(defn md-table [headers rows]
  (if (empty? rows)
    "_(none)_\n"
    (str "| " (str/join " | " headers) " |\n"
         "|" (str/join "|" (repeat (count headers) " --- ")) "|\n"
         (str/join "\n" (map (fn [r] (str "| " (str/join " | " (map #(str/replace (str %) "|" "\\|") r)) " |")) rows))
         "\n")))

(defn section [title body] (str "\n## " title "\n\n" body))
(defn note [s] (str "> " s "\n"))

(defn parse-image
  "image 文字列を {:repo :tag :digest} に分解する。"
  [image]
  (let [[no-digest digest] (str/split image #"@" 2)
        ;; 最後の ':' がポート(host:port)でなく tag かどうか: '/' を含まない
        idx (str/last-index-of no-digest ":")
        tag? (and idx (not (str/includes? (subs no-digest idx) "/")))]
    {:image image
     :repo (if tag? (subs no-digest 0 idx) no-digest)
     :tag (when tag? (subs no-digest (inc idx)))
     :digest digest}))

(defn version-core
  "タグから x.y.z の数値部分だけ取り出す。"
  [s]
  (when s
    (some->> (re-find #"(\d+)\.(\d+)(?:\.(\d+))?" s)
             rest
             (map #(if % (Long/parseLong %) 0))
             vec)))

(defn version-compare [a b]
  (compare (vec (take 3 (concat a (repeat 0)))) (vec (take 3 (concat b (repeat 0))))))

;; ---------------------------------------------------------------- component catalog
;; 露出面のコンポーネント: image repo の部分一致 -> upstream GitHub repo。
;; upstream 最新版 / GHSA / KEV 照合に使う。
(def component-catalog
  [{:name "Argo CD" :match #"argoproj/argocd" :gh "argoproj/argo-cd" :kev-vendor #"(?i)argo"}
   {:name "Grafana" :match #"grafana/grafana" :gh "grafana/grafana" :kev-vendor #"(?i)grafana"}
   {:name "Longhorn manager" :match #"longhornio/longhorn-manager" :gh "longhorn/longhorn" :kev-vendor #"(?i)longhorn|rancher"}
   {:name "cloudflared" :match #"cloudflare/cloudflared" :gh "cloudflare/cloudflared" :kev-vendor #"(?i)cloudflare"}
   {:name "Tailscale operator" :match #"tailscale/k8s-operator" :gh "tailscale/tailscale" :kev-vendor #"(?i)tailscale"}
   {:name "Tailscale proxy" :match #"tailscale/tailscale" :gh "tailscale/tailscale" :kev-vendor #"(?i)tailscale"}
   ;; kubernetes/dashboard の Release は Helm chart (kubernetes-dashboard-7.x) なので、api/vX.Y.Z タグで比較する
   {:name "Kubernetes Dashboard API" :match #"kubernetesui/dashboard-api" :gh "kubernetes/dashboard" :tag-prefix "api/v" :kev-vendor #"(?i)kubernetes"}
   {:name "Kong (dashboard gateway)" :match #"(?:^|/)kong(?::|$)" :gh "Kong/kong" :kev-vendor #"(?i)kong"}
   {:name "TiDB" :match #"pingcap/tidb(?::|$)" :gh "pingcap/tidb" :kev-vendor #"(?i)pingcap|tidb"}
   {:name "dex" :match #"dexidp/dex" :gh "dexidp/dex" :kev-vendor #"(?i)dexidp|\bdex\b"}
   {:name "kube-vip" :match #"kube-vip/kube-vip" :gh "kube-vip/kube-vip" :kev-vendor #"(?i)kube-vip"}
   {:name "kube-apiserver" :match #"kube-apiserver" :gh "kubernetes/kubernetes" :kev-vendor #"(?i)kubernetes"}
   {:name "Calico" :match #"calico/node" :gh "projectcalico/calico" :kev-vendor #"(?i)calico|tigera"}
   {:name "Prometheus" :match #"prometheus/prometheus" :gh "prometheus/prometheus" :kev-vendor #"(?i)prometheus"}
   {:name "Loki" :match #"grafana/loki" :gh "grafana/loki" :kev-vendor #"(?i)loki"}
   {:name "External Secrets" :match #"external-secrets/external-secrets" :gh "external-secrets/external-secrets" :kev-vendor #"(?i)external.secrets"}])

;; ---------------------------------------------------------------- collectors

(defn collect-cluster [pods]
  (let [ver (sh-json "kubectl" "version" "-o" "json")
        nodes (kubectl-json "get" "nodes")
        node-rows (for [n (:items nodes)
                        :let [i (:nodeInfo (:status n))]]
                    [(:name (:metadata n))
                     (if (contains? (:labels (:metadata n)) :node-role.kubernetes.io/control-plane) "control-plane" "worker")
                     (:kubeletVersion i) (:osImage i) (:kernelVersion i) (:containerRuntimeVersion i)])
        apiserver (->> (:items pods) (filter #(str/starts-with? (:name (:metadata %)) "kube-apiserver-")) first)
        cmd (some-> apiserver :spec :containers first :command)
        flag (fn [k] (some #(when (str/starts-with? % (str k "=")) (subs % (inc (count k)))) (or cmd [])))
        api-rows (for [k ["--authorization-mode" "--enable-admission-plugins" "--audit-log-path" "--audit-policy-file"
                          "--anonymous-auth" "--allow-privileged" "--profiling" "--service-account-lookup"
                          "--tls-min-version" "--encryption-provider-config"]]
                   [k (or (flag k) "(unset)")])]
    (str
     (section "1. Cluster / Node versions"
              (str "- kube-apiserver: `" (get-in ver [:serverVersion :gitVersion] "unknown") "`\n\n"
                   (md-table ["node" "role" "kubelet" "os" "kernel" "runtime"] node-rows)
                   (note "ノード OS の apt 更新状況 (`apt list --upgradable`) は ansible 経由で別途確認する (runbook 参照)。")))
     (section "2. kube-apiserver flags (manual CIS checklist)"
              (if apiserver
                (md-table ["flag" "value"] api-rows)
                (note "kube-system の kube-apiserver Pod を取得できなかった。"))))))

(defn exposed-services [svcs]
  (for [s (:items svcs)
        :let [spec (:spec s) ann (:annotations (:metadata s))
              ts? (or (= "tailscale" (:loadBalancerClass spec)) (some? (get ann :tailscale.com/expose)))]
        :when (or (#{"LoadBalancer" "NodePort"} (:type spec)) ts?)]
    {:ns (:namespace (:metadata s)) :name (:name (:metadata s))
     :type (if ts? (str (:type spec) " (tailscale)") (:type spec))
     :ports (str/join "," (map #(str (:port %) (when (:nodePort %) (str "(np" (:nodePort %) ")")) "/" (:protocol %)) (:ports spec)))}))

(defn pod-images [pods]
  (for [pod (:items pods)
        c (concat (:containers (:spec pod)) (:initContainers (:spec pod)))]
    (assoc (parse-image (:image c)) :ns (:namespace (:metadata pod)) :pod (:name (:metadata pod)) :container (:name c))))

(defn collect-exposure [pods svcs arch-root]
  (let [exposed (exposed-services svcs)
        imgs (pod-images pods)
        cf-ns (->> imgs (filter #(re-find #"cloudflare/cloudflared" (:repo %))) (map :ns) distinct sort)
        ts-ns (->> imgs (filter #(re-find #"tailscale/" (:repo %))) (map :ns) distinct sort)
        exposed-ns (-> (set (map :ns exposed)) (into cf-ns) (into ts-ns) (conj "kube-system" "argocd" "monitoring"))
        ns-images (->> imgs (filter #(exposed-ns (:ns %))) (map (juxt :ns :image)) distinct (sort-by (juxt first second)))
        ;; Cloudflare Tunnel terraform dirs
        tf-root (io/file arch-root "terraform" "cloudflare")
        tf-dirs (when (.exists tf-root)
                  (->> (file-seq tf-root) (filter #(and (.isFile %) (str/ends-with? (.getName %) ".tf"))) (map #(.getParentFile %)) distinct))
        has-res? (fn [dir re] (some #(re-find re (slurp %)) (filter #(and (.isFile %) (str/ends-with? (.getName %) ".tf")) (.listFiles dir))))
        tunnel-rows (for [d (sort-by str tf-dirs)
                          :when (has-res? d #"resource \"cloudflare_(zero_trust_tunnel_cloudflared|tunnel)\"")]
                      [(str/replace (.getPath d) (str arch-root "/") "")
                       (if (has-res? d #"resource \"cloudflare_(zero_trust_access_application|access_application)\"") "yes" "**NO**")])]
    [(str
     (section "3. External exposure surface"
              (str "### 3.1 LoadBalancer / NodePort / Tailscale Services\n\n"
                   (md-table ["namespace" "service" "type" "ports"] (map (juxt :ns :name :type :ports) exposed))
                   "\n### 3.2 Namespaces running cloudflared (Tunnel egress)\n\n"
                   (str/join "" (map #(str "- " % "\n") cf-ns))
                   "\n### 3.3 Namespaces running tailscale (operator / proxy)\n\n"
                   (str/join "" (map #(str "- " % "\n") ts-ns))
                   "\n### 3.4 Cloudflare Tunnel terraform dirs and Access application presence\n\n"
                   (md-table ["terraform dir" "access application"] tunnel-rows)
                   (note "`**NO**` の dir は Access で保護されずに公開されている可能性がある。公開意図を確認し、意図なしなら High。")))
     (section "4. Running image tags in exposed namespaces"
              (md-table ["namespace" "image"] ns-images)))
     {:images imgs :exposed-ns exposed-ns}]))

;; -------- upstream / advisory / KEV

(defn load-kev [opts]
  (cond
    (:skip-kev opts) nil
    (:kev-file opts) (json/parse-string (slurp (:kev-file opts)) true)
    :else (let [{:keys [exit out]} (sh "curl" "-fsSL" "--max-time" "120"
                                       "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json")]
            (when (zero? exit) (json/parse-string out true)))))

(defn kev-index [kev]
  (into {} (map (fn [v] [(:cveID v) v]) (:vulnerabilities kev))))

(defn gh-latest
  "upstream 最新版タグ。:tag-prefix があるコンポーネント (monorepo で Release がサブコンポーネント版と
   一致しないもの) は releases/latest ではなく prefix 付きタグの最大版を返す。取得失敗時は nil。"
  [{:keys [gh tag-prefix]}]
  (if tag-prefix
    (let [r (sh-json "gh" "api" (str "repos/" gh "/tags?per_page=100") "--paginate")]
      (when-not (err? r)
        (->> r (map :name) (filter #(str/starts-with? % tag-prefix))
             (keep (fn [t] (when-let [c (version-core (subs t (count tag-prefix)))] [c t])))
             (sort-by first #(version-compare %2 %1)) first second)))
    (let [r (sh-json "gh" "api" (str "repos/" gh "/releases/latest"))]
      (if (err? r) nil (:tag_name r)))))

(defn gh-advisories
  "published GHSA の一覧。取得失敗時は {::error ...} をそのまま返す (0件と区別する)。"
  [repo]
  (sh-json "gh" "api" (str "repos/" repo "/security-advisories?state=published&per_page=100")))

(def ^:private ver-re "v?(\\d+\\.\\d+(?:\\.\\d+)?)(?:[-+][\\w.]+)?")

(defn- parse-piece
  "range 文字列の 1 片 (',' / 'and' で分割済み) を制約グループ (OR の 1 要素) のリストにする。"
  [piece]
  (let [r (str/trim piece)
        cmp (re-seq (re-pattern (str "(>=|<=|>|<|=)\\s*" ver-re)) r)
        span (re-find (re-pattern (str "^" ver-re "\\s*(?:-|through|to)\\s*" ver-re "$")) r)
        before (re-find (re-pattern (str "(?i)^all versions (?:prior to|until|before)\\s*" ver-re)) r)
        single (re-find (re-pattern (str "^" ver-re "$")) r)]
    (cond
      ;; '>=9.2.0 <9.2.10 >=9.3.0 <9.3.4' のように下限が再登場したら別グループにする
      (seq cmp) (->> cmp
                     (map (fn [[_ op v]] [op (version-core v)]))
                     (reduce (fn [groups [op v :as c]]
                               (if (and (#{">=" ">" "="} op) (some #(#{">=" ">" "="} (first %)) (peek groups)))
                                 (conj groups [c])
                                 (conj (pop groups) (conj (peek groups) c))))
                             [[]])
                     (remove empty?))
      span [[[">=" (version-core (nth span 1))] ["<=" (version-core (nth span 2))]]]
      before [[["<" (version-core (nth before 1))]]]
      single [[["=" (version-core (nth single 1))]]]
      :else nil)))

(defn parse-range
  "GHSA の vulnerable_version_range (自由記述) を OR グループのリスト [[[op core] ...] ...] に変換する。
   対応: '>= 1.2.0, < 1.3.0' / '>=9.2.0 <9.2.10 >=9.3.0 <9.3.4' / '3.2.0 through 3.2.11, 3.3.9, and 3.4.1' /
   'All versions prior to 1.7.14 and 1.8.7' / '< 3.0.0' / 単一版。解釈できない片が 1 つでもあれば nil。"
  [range-str]
  (let [r (str/trim (str range-str))
        ;; 'All versions prior to 1.7.14 and 1.8.7' は各メンテナンス系列の上限を列挙した表現。
        ;; 安全側に '< 1.7.14 OR < 1.8.7' (= 最大値未満すべて) と解釈し、系列内のパッチ有無は
        ;; affected? が patched_versions で判定する。
        before-many (re-find (re-pattern (str "(?i)^all versions (?:prior to|until|before)\\s+(" ver-re "(?:(?:\\s*,\\s*|\\s+and\\s+|\\s*,\\s*and\\s+)" ver-re ")+)$")) r)
        ;; ',' と ' and ' で分割。ただし '>= a, < b' のような比較子の列は 1 片として扱う
        pieces (if (re-find #"(>=|<=|>|<)" r)
                 [(str/replace r #"\s*,\s*" " ")]
                 (->> (str/split r #"\s*,\s*|\s+and\s+")
                      (map #(str/replace % #"^(?i)and\s+" ""))
                      (remove str/blank?)))
        parsed (if before-many
                 [(->> (re-seq (re-pattern ver-re) (second before-many))
                       (map (fn [[_ v]] [["<" (version-core v)]]))
                       vec)]
                 (map parse-piece pieces))]
    (when (and (seq parsed) (every? some? parsed))
      (vec (apply concat parsed)))))

(defn in-range? [running-core groups]
  (some (fn [group]
          (every? (fn [[op v]]
                    (let [c (version-compare running-core v)]
                      (case op ">=" (>= c 0) ">" (pos? c) "<=" (<= c 0) "<" (neg? c) "=" (zero? c) false)))
                  group))
        groups))

(defn affected?
  "稼働版が GHSA の影響を受けるか。
   - vulnerable_version_range を解釈し、範囲外なら :fixed。
   - 範囲内なら patched_versions の同系列 (major.minor) パッチ版と比較し、未満なら :affected、以上なら :fixed。
     同系列のパッチが無く上位系列のパッチもすべて稼働版より古ければ :fixed、patched が無ければ :unknown。
   - 範囲が解釈できない場合は、patched_versions の最大値より稼働版が新しければ :fixed、それ以外は :unknown。"
  [running-core adv]
  (if (nil? running-core)
    :unknown
    (let [vulns (:vulnerabilities adv)
          ranges (map #(parse-range (:vulnerable_version_range %)) vulns)
          patched (->> vulns (mapcat #(str/split (str (:patched_versions %)) #"[,\s]+")) (map version-core) (remove nil?))
          same-series (filter #(= (take 2 %) (take 2 running-core)) patched)
          max-patched (when (seq patched) (first (sort-by identity #(version-compare %2 %1) patched)))
          newer-than-all-patched? (and max-patched (pos? (version-compare running-core max-patched)))
          patched-verdict (cond
                            (seq same-series) (if (neg? (version-compare running-core (apply max-key #(nth % 2) same-series))) :affected :fixed)
                            newer-than-all-patched? :fixed
                            (seq patched) :affected
                            :else :unknown)]
      (cond
        (and (seq ranges) (every? some? ranges))
        (if (some #(in-range? running-core %) ranges) patched-verdict :fixed)
        newer-than-all-patched? :fixed
        :else :unknown))))

(defn collect-nday [images kev opts]
  (let [kev-idx (kev-index kev)
        running (for [c component-catalog
                      :let [tags (->> images (filter #(re-find (:match c) (:repo %))) (map #(or (:tag %) "(digest-only)")) distinct sort)]
                      :when (seq tags)]
                  (assoc c :tags tags))
        worst (fn [verdicts] (cond (some #{:affected} verdicts) :affected (some #{:unknown} verdicts) :unknown :else :fixed))
        rows (for [c running
                   :let [latest (when-not (:skip-github opts) (gh-latest c))
                         advs-raw (if (:skip-github opts) [] (gh-advisories (:gh c)))
                         ghsa-error (when (err? advs-raw) (::error advs-raw))
                         advs (if ghsa-error [] advs-raw)
                         cores (map version-core (:tags c))
                         unparsed (seq (filter #(nil? (version-core %)) (:tags c)))
                         latest-core (version-core latest)
                         behind (cond (nil? latest-core) "?"
                                      (some #(and % (neg? (version-compare % latest-core))) cores) "**behind**"
                                      unparsed "? (unparsable tag)"
                                      :else "ok")
                         ;; 全稼働タグで評価し最悪の結果を採用。解釈不能タグ (latest 等) は unknown 扱い。
                         verdict (fn [a] (worst (map #(affected? % a) (if unparsed (conj (vec cores) nil) cores))))
                         open (filter #(= :affected (verdict %)) advs)
                         unknown (filter #(= :unknown (verdict %)) advs)
                         kev-hits (->> advs (remove #(= :fixed (verdict %))) (keep :cve_id) (filter kev-idx))
                         kev-vendor (->> (:vulnerabilities kev) (filter #(re-find (:kev-vendor c) (str (:vendorProject %) " " (:product %)))) (map :cveID))]]
               {:c c :latest latest :behind behind :open open :unknown unknown :kev-hits kev-hits :kev-vendor kev-vendor :ghsa-error ghsa-error :verdict verdict})
        table (md-table ["component" "running tag(s)" "upstream latest" "status" "GHSA affecting running" "KEV (CVE in GHSA, not fixed for running)" "KEV (vendor/product match)"]
                        (for [{:keys [c latest behind open kev-hits kev-vendor ghsa-error]} rows]
                          [(:name c) (str/join ", " (map #(str "`" % "`") (:tags c))) (or latest "?") behind
                           (cond ghsa-error "**GHSA fetch failed** (manual check)"
                                 (:skip-github opts) "skipped"
                                 (seq open) (str "**" (count open) "**: " (str/join ", " (map #(or (:cve_id %) (:ghsa_id %)) open)))
                                 :else "0")
                           (if (seq kev-hits) (str "**" (str/join ", " kev-hits) "**") "-")
                           (if (seq kev-vendor) (str/join ", " (take 8 kev-vendor)) "-")]))
        cutoff (str (.minusDays (java.time.LocalDate/now) 540))
        recent? (fn [a] (or (:all-advisories opts) (pos? (compare (str (:published_at a)) cutoff))))
        detail (for [{:keys [c open unknown verdict]} rows :when (or (seq open) (seq unknown))
                     :let [old-unknown (remove recent? unknown)]]
                 (str "### " (:name c) " (running " (str/join ", " (:tags c)) ")\n\n"
                      (when (seq old-unknown)
                        (str "- 18 か月より前に公開された判定不能 advisory " (count old-unknown) " 件は省略 (`--all-advisories` で表示)\n\n"))
                      (md-table ["ghsa" "cve" "severity" "published" "vulnerable range → patched" "judgement" "summary"]
                                (for [a (concat open (filter recent? unknown))]
                                  [(:ghsa_id a) (or (:cve_id a) "-") (:severity a) (subs (str (:published_at a)) 0 10)
                                   (str/join "; " (map #(str (:vulnerable_version_range %) " → " (:patched_versions %)) (:vulnerabilities a)))
                                   (name (verdict a))
                                   (str/replace (str (:summary a)) #"\n" " ")]))))]
    (str
     (section "0. n-day / known-vulnerability check (PRIORITY)"
              (str (if kev
                     (str "- CISA KEV feed: " (:count kev) " entries, released " (:dateReleased kev) "\n")
                     "- CISA KEV feed: **not loaded** (skipped or fetch failed) — KEV 照合は手動で行う\n")
                   (if (:skip-github opts) "- GitHub releases / GHSA: skipped\n" "")
                   "\n" table
                   (note "判定: KEV 列に CVE があれば無条件 **Critical** (即時起票)。`GHSA affecting running` が 1 以上で severity critical/high なら **High** 以上。`behind` のみは Medium (パッチ追従)。`judgement=unknown` は vulnerable range / patched_versions を機械判定できなかったもの、`GHSA fetch failed` は API 取得失敗 (0件ではない) で、いずれも手動確認する。")
                   "\n" (str/join "\n" detail))))))

;; -------- workload hardening

(defn workload-name
  "Pod 名から ReplicaSet/StatefulSet/DaemonSet のサフィックスを落として workload 名に寄せる。"
  [pod]
  (let [owner (first (:ownerReferences (:metadata pod)))
        nm (:name (:metadata pod))]
    (case (:kind owner)
      "ReplicaSet" (str/replace (:name owner) #"-[0-9a-f]{6,10}$" "")
      ("DaemonSet" "StatefulSet" "Job") (:name owner)
      "Node" (str/replace nm (str "-" (:name owner)) "")
      nm)))

(defn collect-hardening [pods nss netpols crbs]
  (let [ns-names (map #(:name (:metadata %)) (:items nss))
        pod-ns (set (map #(:namespace (:metadata %)) (:items pods)))
        psa-missing (for [n (:items nss)
                          :let [l (:labels (:metadata n)) nm (:name (:metadata n))]
                          :when (nil? (get l :pod-security.kubernetes.io/enforce))]
                      [nm (if (pod-ns nm) "yes" "no") (or (get l :pod-security.kubernetes.io/warn) "-")])
        priv-rows (for [pod (:items pods)
                        :let [spec (:spec pod)
                              priv (->> (concat (:containers spec) (:initContainers spec))
                                        (filter #(or (true? (get-in % [:securityContext :privileged]))
                                                     (some #{"SYS_ADMIN" "NET_ADMIN" "ALL"} (get-in % [:securityContext :capabilities :add]))))
                                        (map :name))
                              flags (cond-> []
                                      (seq priv) (conj (str "privileged/caps:" (str/join "," priv)))
                                      (:hostNetwork spec) (conj "hostNetwork")
                                      (:hostPID spec) (conj "hostPID")
                                      (:hostIPC spec) (conj "hostIPC")
                                      (some #(contains? % :hostPath) (:volumes spec)) (conj "hostPath"))]
                        :when (seq flags)]
                    [(:namespace (:metadata pod)) (workload-name pod) (str/join " " flags)])
        priv-rows (distinct priv-rows)
        imgs (pod-images pods)
        latest-rows (->> imgs
                         (filter #(and (nil? (:digest %)) (or (nil? (:tag %)) (= "latest" (:tag %)))))
                         (map (juxt :ns :pod :container :image)) distinct)
        nodigest (->> imgs (remove :digest) (map :image) distinct count)
        total (->> imgs (map :image) distinct count)
        crb-rows (for [b (:items crbs)
                       :when (= "cluster-admin" (get-in b [:roleRef :name]))
                       s (:subjects b)]
                   [(:name (:metadata b)) (:kind s) (str (when (:namespace s) (str (:namespace s) "/")) (:name s))])
        np-ns (set (map #(:namespace (:metadata %)) (:items netpols)))
        np-missing (for [n (sort ns-names) :when (and (pod-ns n) (not (np-ns n)))] [n])]
    (str
     (section "5. Pod Security Admission: namespaces without `enforce` label"
              (str (md-table ["namespace" "has pods" "warn label"] psa-missing)
                   (note "Pod を持つ namespace で enforce 無しは Medium。外部露出 ns (hitohub/argocd/monitoring 等) は High 寄り。")))
     (section "6. privileged / hostNetwork / hostPID / hostPath Pods"
              (str (md-table ["namespace" "pod" "flags"] priv-rows)
                   (note "longhorn/kube-system/calico/node-exporter/kube-vip/control-plane static Pod は想定内。それ以外が増えていたら High。")))
     (section "7. Images with `:latest` / no tag (and digest-less summary)"
              (str (md-table ["namespace" "pod" "container" "image"] latest-rows)
                   (format "\n- digest 未固定 image: %d / %d (ユニーク)\n" nodigest total)
                   (note "`:latest` は版数追従が検証不能なので High。digest 未固定は Low (記録のみ)。")))
     (section "8. cluster-admin ClusterRoleBindings"
              (str (md-table ["binding" "kind" "subject"] crb-rows)
                   (note "`system:masters` / `kubeadm:cluster-admins` は kubeadm 既定。新しい subject が増えていたら High。")))
     (section "9. Namespaces with Pods but no NetworkPolicy"
              (str (md-table ["namespace"] np-missing)
                   (note "argocd は repo-server/redis/server への NetworkPolicy が upstream 既定で存在する。削除されていれば High (BOXP-217 Context 参照)。"))))))

;; -------- Argo CD, Dependabot

(defn collect-argocd []
  (let [apps (kubectl-json "get" "applications.argoproj.io" "-A")]
    (section "10. Argo CD applications not Synced/Healthy"
             (if (err? apps)
               (note (str "applications.argoproj.io を取得できなかった: " (::error apps)))
               (md-table ["namespace" "app" "sync" "health" "revision"]
                         (for [a (:items apps)
                               :let [sync (get-in a [:status :sync :status]) health (get-in a [:status :health :status])]
                               :when (not (and (= "Synced" sync) (= "Healthy" health)))]
                           [(:namespace (:metadata a)) (:name (:metadata a)) (or sync "-") (or health "-")
                            (some-> (get-in a [:status :sync :revision]) (subs 0 7))]))))))

(defn collect-dependabot [repos opts]
  (section "11. GitHub Dependabot open alerts"
           (if (:skip-github opts)
             (note "skipped")
             (str/join "\n"
                       (for [repo repos
                             :let [alerts (sh-json "gh" "api" (str "repos/" repo "/dependabot/alerts?state=open&per_page=100"))]]
                         (str "### " repo "\n\n"
                              (if (err? alerts)
                                (note (str "取得失敗: " (::error alerts)))
                                (md-table ["#" "severity" "package" "manifest" "cve" "ghsa" "summary"]
                                          (for [a (sort-by #(get-in % [:security_advisory :severity]) alerts)]
                                            [(:number a) (get-in a [:security_advisory :severity])
                                             (str (get-in a [:dependency :package :ecosystem]) "/" (get-in a [:dependency :package :name]))
                                             (get-in a [:dependency :manifest_path])
                                             (or (get-in a [:security_advisory :cve_id]) "-")
                                             (get-in a [:security_advisory :ghsa_id])
                                             (get-in a [:security_advisory :summary])])))))))))

;; -------- trivy

(defn collect-trivy [images opts]
  (let [uniq (->> images (map :image) distinct sort)]
    (when-let [out (:images-out opts)]
      (spit out (str (str/join "\n" uniq) "\n")))
    (section "12. trivy image scan (CRITICAL/HIGH, fixed only)"
             (cond
               (not (:trivy opts)) (note (str "`--trivy` 未指定。ユニーク image " (count uniq) " 件"
                                              (when (:images-out opts) (str " を `" (:images-out opts) "` に書き出した"))
                                              "。runbook の trivy 手順でスキャンする。"))
               (not (zero? (:exit (sh "sh" "-c" "command -v trivy")))) (note "trivy が PATH に無い。")
               :else
               (str/join "\n"
                         (for [img uniq
                               :let [r (sh "trivy" "image" "--quiet" "--severity" "CRITICAL,HIGH" "--ignore-unfixed"
                                           "--scanners" "vuln" "--format" "json" "--timeout" "10m" img)]]
                           (if-not (zero? (:exit r))
                             (str "- `" img "`: scan failed (" (first (str/split-lines (str (:err r)))) ")")
                             (let [res (json/parse-string (:out r) true)
                                   vulns (mapcat :Vulnerabilities (:Results res))
                                   crit (count (filter #(= "CRITICAL" (:Severity %)) vulns))
                                   high (count (filter #(= "HIGH" (:Severity %)) vulns))]
                               (str "- `" img "`: CRITICAL " crit ", HIGH " high
                                    (when (pos? crit) (str " — " (str/join ", " (distinct (map :VulnerabilityID (filter #(= "CRITICAL" (:Severity %)) vulns)))))))))))))))

;; ---------------------------------------------------------------- main

(defn parse-args [args]
  (loop [a args m {:repos ["boxp/arch" "boxp/lolice"]}]
    (if (empty? a)
      m
      (let [[k v & more] a]
        (case k
          "--out" (recur more (assoc m :out v))
          "--arch-root" (recur more (assoc m :arch-root v))
          "--kev-file" (recur more (assoc m :kev-file v))
          "--images-out" (recur more (assoc m :images-out v))
          "--repos" (recur more (assoc m :repos (str/split v #",")))
          "--skip-github" (recur (rest a) (assoc m :skip-github true))
          "--skip-kev" (recur (rest a) (assoc m :skip-kev true))
          "--trivy" (recur (rest a) (assoc m :trivy true))
          "--all-advisories" (recur (rest a) (assoc m :all-advisories true))
          "--help" (do (println (second (str/split (slurp *file*) #";; 使い方:\n|\n;; 前提"))) (System/exit 0))
          (do (binding [*out* *err*] (println "unknown arg" k)) (System/exit 2)))))))

(defn script-arch-root []
  (-> (io/file *file*) .getAbsoluteFile .getParentFile .getParentFile .getParentFile .getPath))

(defn -main [& args]
  (let [opts (parse-args args)
        arch-root (or (:arch-root opts) (script-arch-root))
        must (fn [what & args]
               (let [r (apply kubectl-json args)]
                 (when (err? r)
                   (binding [*out* *err*] (println "required collection failed:" what (::error r)))
                   (System/exit 1))
                 r))
        pods (must "pods" "get" "pods" "-A")
        svcs (must "services" "get" "svc" "-A")
        nss (must "namespaces" "get" "ns")
        netpols (must "networkpolicies" "get" "networkpolicies" "-A")
        crbs (must "clusterrolebindings" "get" "clusterrolebindings")
        kev (load-kev opts)
        exposure (collect-exposure pods svcs arch-root)
        [exposure-md exposure-data] exposure
        images (pod-images pods)
        exposed-images (filter #((:exposed-ns exposure-data #{}) (:ns %)) images)
        today (str (java.time.LocalDate/now))
        report (str "# lolice security audit report — " today "\n\n"
                    "- generated by `scripts/security-audit/security_audit.bb` (BOXP-217)\n"
                    "- arch root: `" arch-root "`\n"
                    "- 本レポートに Secret 本文 / credential / ノード IP は含めない。貼り付け前に runbook の公開可否基準を確認する。\n"
                    (collect-nday exposed-images kev opts)
                    (collect-cluster pods)
                    exposure-md
                    (collect-hardening pods nss netpols crbs)
                    (collect-argocd)
                    (collect-dependabot (:repos opts) opts)
                    (collect-trivy images opts))]
    (if (:out opts)
      (do (spit (:out opts) report) (println "wrote" (:out opts)))
      (println report))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
