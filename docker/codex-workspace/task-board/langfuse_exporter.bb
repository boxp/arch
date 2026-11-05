#!/usr/bin/env bb
;; Fail closed: the exporter transport and session parsing are not implemented yet.
(ns langfuse-exporter
  (:require [clojure.string :as str]))

(def secret-name-pattern
  #"(?i)(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential|session[_-]?id|cookie|auth)")

(def patterns
  [[:private-key #"(?s)-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----"]
   [:header #"(?im)\b(?:proxy-authorization|authorization|set-cookie|cookie)\s*:\s*[^\r\n]+"]
   [:url-credentials #"(?i)\b[a-z][a-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@"]
   [:jwt #"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"]
   [:provider-key #"\b(?:sk-lf-|pk-lf-|sk-|ghp_|gho_|ghs_|ghu_|github_pat_|xox[baprs]-|npm_|glpat-)[A-Za-z0-9_-]+"]
   [:aws-key #"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"]
   [:google-key #"\bAIza[A-Za-z0-9_-]{30,}\b"]
   [:telegram #"\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b"]
   [:bearer #"(?i)\bbearer\s+[A-Za-z0-9._~+/-]+=*"]
   [:assignment #"(?i)(?:[\"']?[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential|session[_-]?id|cookie|auth)[\w.-]*[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;}]+)"]
   [:entropy #"\b[A-Za-z0-9_-]{40,}\b"]])

(defn secret-values [env]
  (->> env (keep (fn [[k v]] (when (and (re-find secret-name-pattern (str k))
                                          (string? v) (<= 8 (count v))) v)))
       (sort-by count >)))

(defn entropy-secret? [s]
  (and (not (re-matches #"(?i)[0-9a-f]{40}" s))
       (>= (count (filter identity [(re-find #"[a-z]" s) (re-find #"[A-Z]" s)
                                    (re-find #"[0-9]" s) (re-find #"[_-]" s)])) 3)))

(defn redact
  "Mask known secret forms and environment values. On any error, drop the field."
  [s values]
  (try
    (let [counts (atom {})
          mark (fn [kind] (swap! counts update kind (fnil inc 0)) (str "[REDACTED:" (name kind) "]"))
          with-values (reduce (fn [text value]
                                (if (str/includes? text value)
                                  (str/replace text (re-pattern (java.util.regex.Pattern/quote value)) (fn [_] (mark :env))) text))
                              (str s) values)
          masked (reduce (fn [text [kind pattern]]
                           (str/replace text pattern
                             (fn [match]
                               (let [m (if (vector? match) (first match) match)]
                                 (if (and (= kind :entropy) (not (entropy-secret? m))) m (mark kind))))))
                         with-values patterns)]
      {:value masked :redactions @counts})
    (catch Throwable _ {:value "[dropped: redaction error]" :redactions {:error 1}})))

(def sensitive-path
  #"(?i)(?:^|[/\\\s])(?:auth\.json|\.credentials|\.env(?:\.[\w-]+)?|\.ssh(?:[/\\]|$)|\.aws(?:[/\\]|$)|kubeconfig|\.git-credentials|\.netrc|id_rsa|secrets?(?:[/\\]|$)|[^/\s]*token[^/\s]*)(?:$|[/\\\s])")
(def sensitive-command
  #"(?i)(?:^|[;&|\s])(?:env|printenv)(?:\s|$)|\bkubectl\s+(?:get|describe)\s+secrets?\b|\baws\s+ssm\s+get-parameter\b[^\n]*--with-decryption\b|\bcat\s+/proc/[^/\s]+/environ\b|\bgh\s+auth\s+token\b|\bgit\s+credential\b")
(defn withhold-output? [input]
  (let [s (str input)] (boolean (or (re-find sensitive-path s) (re-find sensitive-command s)))))

(defn guard-safe? [payload values]
  ;; Scan again instead of relying on the caller's per-field pass.
  (let [result (redact payload values)]
    (and (not= "[dropped: redaction error]" (:value result))
         (empty? (:redactions result)))))

(defn -main [& _]
  (binding [*out* *err*]
    (println "Exporter unavailable: session parsing and guarded delivery are not implemented."))
  (System/exit 1))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
