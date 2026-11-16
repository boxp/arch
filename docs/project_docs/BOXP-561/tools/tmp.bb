(require '[clojure.java.io :as io] '[clojure.string :as str])
(defn tmproot []
  (let [v (System/getenv "BOXP561_TMP") base "/home/boxp/.codex-task-board/workspaces/BOXP-561/"]
    (when-not (and v (.isAbsolute (io/file v)) (.isDirectory (io/file v)) (str/starts-with? (.getCanonicalPath (io/file v)) base))
      (throw (ex-info "BOXP561_TMP must be an existing absolute directory under the BOXP-561 workspace" {})))
    (.getCanonicalPath (io/file v))))
(defn under-tmp? [p] (str/starts-with? (.getCanonicalPath (io/file p)) (str (tmproot) "/")))
