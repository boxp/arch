#!/usr/bin/env bb
;; 公開 IaC から図に関わる構造の事実だけを取り出し、受入済みの基準と比べる。
;; 設定値、image tag、digest、version は事実に含めない。renovate の更新だけでは差分にならない。
;; Service の selector と Ingress の backend は接続先そのものなので事実に含める。
;; usage:
;;   iac_facts.bb collect --arch DIR --lolice DIR --rules FILE --out FACTS.json
;;   iac_facts.bb compare --facts FACTS.json --baseline BASE.json --rules FILE --out RESULT.json
(require '[babashka.fs :as fs]
         '[babashka.process :refer [shell]]
         '[cheshire.core :as json]
         '[clj-yaml.core :as yaml]
         '[clojure.edn :as edn]
         '[clojure.set :as set]
         '[clojure.string :as str])

(defn tracked [dir & pathspecs]
  (->> (apply shell {:out :string :dir dir} "git" "ls-files" "--" pathspecs)
       :out str/split-lines (remove str/blank?)))

(def host-re #"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:b0xp\.io|boxp\.tk)\b")

(def svc-ref-re
  "クラスタ内 Service の DNS 名。Tunnel の転送先や BFF の接続先 URL など、既存の資源への接続の追加はこの形で現れる。"
  #"\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.svc(?:\.cluster\.local)?(?::(\d+))?\b")

(defn svc-refs [text]
  (distinct (for [[_ svc ns port] (re-seq svc-ref-re text)]
              (str svc "." ns (when port (str ":" port))))))

(defn tf-facts [dir]
  (mapcat
   (fn [path]
     (let [text (slurp (str (fs/path dir path)))
           where (str (fs/parent path))]
       (concat
        (for [r (svc-refs text)] (str "arch:svc-ref:" where "->" r))
        (for [[_ kind a b] (re-seq #"(?m)^(resource|module)\s+\"([^\"]+)\"(?:\s+\"([^\"]+)\")?" text)]
          (if (= kind "module")
            (str "arch:tf:module:" where "/" a)
            (str "arch:tf:" a ":" where "/" b)))
        (for [h (re-seq host-re text)] (str "arch:host:" h)))))
   (remove #(re-find #"(^|/)(aqua|\.terraform)/" %) (tracked dir "*.tf"))))

(defn top-names [dir prefix paths]
  (->> paths
       (keep (fn [p] (when (str/starts-with? p prefix)
                       (first (str/split (subs p (count prefix)) #"/")))))
       distinct))

(defn arch-facts [dir]
  (let [paths (tracked dir "apps" "docker" "ansible/roles" ".github/workflows")]
    (concat
     (tf-facts dir)
     (map #(str "arch:app:" %) (top-names dir "apps/" paths))
     (map #(str "arch:image:" %) (top-names dir "docker/" paths))
     (map #(str "arch:ansible-role:" %) (top-names dir "ansible/roles/" paths))
     (map #(str "arch:workflow:" %) (top-names dir ".github/workflows/" paths)))))

(defn image-repo [image]
  (-> (str image) (str/replace #"@.*$" "") (str/replace #":[^/:]+$" "")))

(defn pod-spec [doc]
  (or (get-in doc [:spec :template :spec])
      (get-in doc [:spec :jobTemplate :spec :template :spec])))

(defn backend-target
  "Ingress の backend の接続先。v1 の service、resource と、古い serviceName の形を読む。"
  [backend]
  (let [svc (:service backend)
        res (:resource backend)]
    (cond
      svc (str (:name svc) ":" (or (get-in svc [:port :number]) (get-in svc [:port :name]) "-"))
      res (str "resource/" (:kind res) "/" (:name res))
      (:serviceName backend) (str (:serviceName backend) ":" (or (:servicePort backend) "-")))))

(defn ingress-backend-facts [id doc]
  (let [fact (fn [host path backend]
               (when-let [target (backend-target backend)]
                 (str "lolice:ingress-backend:" id ":" host ":" path "->" target)))
        spec (:spec doc)]
    (remove nil?
            (concat
             (when-let [b (or (:defaultBackend spec) (:backend spec))]
               [(fact "*" "*" b)])
             (for [r (:rules spec)
                   p (get-in r [:http :paths])]
               (fact (or (:host r) "*") (or (:path p) "/") (:backend p)))))))

(defn- compact [s] (str/replace (str s) #"\s+" ""))

(defn- k8s-labels [sel]
  (some->> (:matchLabels sel) (sort-by key) (map (fn [[k v]] (str (subs (str k) 1) "=" v))) seq (str/join ",")))

(defn- k8s-peer [p]
  (str/join ";" (remove nil? [(when-let [s (k8s-labels (:namespaceSelector p))] (str "ns:" s))
                              (when (contains? p :namespaceSelector) (when-not (k8s-labels (:namespaceSelector p)) "ns:*"))
                              (when-let [s (k8s-labels (:podSelector p))] (str "pod:" s))
                              (when-let [c (get-in p [:ipBlock :cidr])] (str "net:" c))])))

(defn- calico-peer [e]
  (str/join ";" (remove nil? [(when (:namespaceSelector e) (str "ns:" (compact (:namespaceSelector e))))
                              (when (:selector e) (str "sel:" (compact (:selector e))))
                              (when (:serviceAccountSelector e) (str "sa:" (compact (:serviceAccountSelector e))))
                              (when (seq (:nets e)) (str "net:" (str/join "," (:nets e))))
                              (when (seq (:notNets e)) (str "notnet:" (str/join "," (:notNets e))))
                              (when (:domains e) (str "dns:" (str/join "," (:domains e))))])))

(defn- ports [ps] (if (seq ps) (str/join "," (map #(if (map? %) (or (:port %) "-") %) ps)) "*"))

(defn netpol-facts
  "NetworkPolicy の通信相手と port。既存の policy に許可先を足しただけの接続の追加も差分になる。"
  [id doc]
  (let [fact (fn [dir peer ps action]
               (str "lolice:netpol:" id ":" dir ":"
                    (when (and action (not= "Allow" action)) (str (str/lower-case action) "!"))
                    (if (str/blank? peer) "*" peer) ":" ps))
        spec (:spec doc)]
    (if (str/starts-with? (str (:apiVersion doc)) "projectcalico.org")
      (concat
       (for [r (:ingress spec)] (fact "ingress" (calico-peer (:source r)) (ports (get-in r [:destination :ports])) (:action r)))
       (for [r (:egress spec)] (fact "egress" (calico-peer (:destination r)) (ports (get-in r [:destination :ports])) (:action r))))
      (concat
       (for [r (:ingress spec) p (or (seq (:from r)) [{}])] (fact "ingress" (k8s-peer p) (ports (:ports r)) nil))
       (for [r (:egress spec) p (or (seq (:to r)) [{}])] (fact "egress" (k8s-peer p) (ports (:ports r)) nil))))))

(defn- strings [x]
  (cond (string? x) [x]
        (map? x) (mapcat strings (vals x))
        (coll? x) (mapcat strings x)
        :else []))

(defn manifest-facts [doc]
  (let [kind (:kind doc)
        ns* (or (get-in doc [:metadata :namespace]) "-")
        nm (get-in doc [:metadata :name])
        id (str ns* "/" nm)
        spec (pod-spec doc)]
    (when (and kind nm (:apiVersion doc) (not= "Kustomization" kind))
      (concat
       [(str "lolice:k8s:" kind ":" id)]
       (for [c (concat (:containers spec) (:initContainers spec))
             :when (:image c)]
         (str "lolice:image:" kind "/" id ":" (image-repo (:image c))))
       (when (= "Service" kind)
         (concat
          (for [p (get-in doc [:spec :ports])] (str "lolice:svc-port:" id ":" (:port p)))
          (for [[k v] (get-in doc [:spec :selector])]
            ;; app.kubernetes.io/name のような key は name だと接頭辞が落ちるので、keyword の全体を使う
            (str "lolice:svc-selector:" id ":" (subs (str k) 1) "=" v))))
       ;; 接続先の URL（env、ConfigMap の設定ファイルなど）。値そのものではなく、どの Service へつなぐかだけを残す
       (for [r (distinct (mapcat svc-refs (strings (dissoc doc :metadata :status))))]
         (str "lolice:svc-ref:" kind "/" id "->" r))
       (when (#{"NetworkPolicy" "GlobalNetworkPolicy"} kind)
         (netpol-facts id doc))
       (when (= "Ingress" kind)
         (concat
          (for [r (get-in doc [:spec :rules]) :when (:host r)] (str "arch:host:" (:host r)))
          (ingress-backend-facts id doc)))
       (when (= "Application" kind)
         (for [s (or (get-in doc [:spec :sources]) (some-> (get-in doc [:spec :source]) vector))]
           (str "lolice:argocd-source:" id ":" (:repoURL s) ":" (or (:chart s) (:path s)))))))))

(defn lolice-facts [dir]
  (let [paths (tracked dir "argoproj/*.yaml" "argoproj/*.yml")
        parsed (map (fn [path]
                      (try ;; 複数文書の解析は遅延するので、ここで実体化して例外を捕まえる
                           {:docs (vec (yaml/parse-string (slurp (str (fs/path dir path)))
                                                          :load-all true :unknown-tag-fn :value))}
                           (catch Exception _ {:error path})))
                    paths)]
    {:facts (concat (map #(str "lolice:dir:" %) (top-names dir "argoproj/" paths))
                    (mapcat manifest-facts (filter map? (mapcat :docs parsed))))
     :unparsed (vec (keep :error parsed))}))

(defn read-json [path] (json/parse-string (slurp (str path)) true))
(defn write-json! [path value]
  (fs/create-dirs (fs/parent (fs/absolutize path)))
  (spit (str path) (str (json/generate-string value {:pretty true}) "\n")))

(defn sha256 [^String s]
  (apply str (map #(format "%02x" %)
                  (.digest (java.security.MessageDigest/getInstance "SHA-256") (.getBytes s "UTF-8")))))

(defn excluded? [rules fact]
  (some #(re-find (re-pattern %) fact) (:exclude-fact-patterns rules)))

(defn category [fact] (str/join ":" (take 3 (str/split fact #":" 4))))

(defn section
  "異常判定で使う種類。先頭 2 要素なので live:app:x は live:app、live:ns:y は live:ns になり、live 全体へまとまらない。"
  [fact]
  (str/join ":" (take 2 (str/split fact #":" 3))))

(defn compare-facts
  "基準と比べた結果を返す。減りすぎは資源の削除と読まず anomaly にする。"
  [rules min-facts facts baseline]
  (let [now (set (remove #(excluded? rules %) facts))
        base (set (remove #(excluded? rules %) baseline))
        added (vec (sort (set/difference now base)))
        removed (vec (sort (set/difference base now)))
        new-cats (vec (sort (set/difference (set (map category now)) (set (map category base)))))
        now-sections (set (map section now))
        ;; 権限拒否で 1 種類だけ空になった場合を、全部削除されたと読まない
        vanished (->> (frequencies (map section base))
                      (filter (fn [[k n]] (and (>= n 5) (not (now-sections k)))))
                      (map first) sort vec)
        anomaly (cond
                  (< (count now) min-facts) (str "facts too few: " (count now))
                  (and (seq base) (> (/ (count removed) (count base)) (:max-removed-ratio rules)))
                  (str "too many removed: " (count removed) "/" (count base))
                  (seq vanished) (str "whole section vanished: " (str/join "," vanished)))]
    {:status (cond anomaly "anomaly" (or (seq added) (seq removed)) "changed" :else "no-change")
     :reason anomaly
     :fact_count (count now)
     :added (if anomaly [] added)
     :removed (if anomaly [] removed)
     :new_categories (if anomaly [] new-cats)
     :fingerprint (when-not anomaly (sha256 (str/join "\n" (concat (map #(str "+" %) added) (map #(str "-" %) removed)))))}))

(defn opts [args]
  (into {} (map (fn [[k v]] [(keyword (subs k 2)) v]) (partition 2 args))))

(defn cmd-collect [{:keys [arch lolice rules out]}]
  (let [r (edn/read-string (slurp rules))
        {:keys [facts unparsed]} (lolice-facts lolice)
        all (->> (concat (arch-facts arch) facts) (remove #(excluded? r %)) distinct sort vec)]
    (write-json! out {:schema 1 :facts all :unparsed unparsed})
    (println "collected" (count all) "facts," (count unparsed) "unparsed files")))

(defn cmd-compare [{:keys [facts baseline rules out simulate]}]
  (let [r (edn/read-string (slurp rules))
        f (read-json facts)
        b (read-json baseline)
        sim? (= "true" simulate)
        ;; 経路の確認用。受け口はこの結果からチケットを作らない
        now (cond-> (vec (:facts f)) sim? (conj "arch:canary:simulated-change"))
        result (compare-facts r (:min-iac-facts r) now (:facts b))
        ;; 解析できない manifest は消えたように見えるので、差分の結論を出さない
        result (if (and (seq (:unparsed f)) (not= "anomaly" (:status result)))
                 (assoc result :status "anomaly" :reason (str "unparsed manifests: " (count (:unparsed f))) :added [] :removed [] :new_categories [] :fingerprint nil)
                 result)]
    (write-json! out (assoc result :simulated sim? :unparsed (:unparsed f)))
    (println (:status result) "added" (count (:added result)) "removed" (count (:removed result))
             (or (:reason result) ""))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [[cmd & args] *command-line-args*]
    (case cmd
      "collect" (cmd-collect (opts args))
      "compare" (cmd-compare (opts args))
      (do (println "usage: iac_facts.bb collect|compare ...") (System/exit 2)))))
