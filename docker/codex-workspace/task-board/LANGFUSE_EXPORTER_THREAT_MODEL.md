# langfuse_exporter.bb: threat model and accepted residual (BOXP-428 TD-07)

This file records the observation contract the Owner approved on 2026-11-06 ("その方針にしましょう").
It is the review boundary for the Task Board exporter, and matches the Hermes observer
(`boxp/lolice` `argoproj/hermes-agent/plugins/boxp-langfuse-observer/THREAT_MODEL.md`).
The source of truth is the vault note `Projects/langfuse-observability/request.md` (top section).

## Deployment boundary

- Bodies go only to the in-cluster Langfuse (`argoproj/langfuse` in lolice), never to an external SaaS or LLM.
- The UI is Owner-only (Cloudflare Access + Langfuse OIDC, sign-up and password login disabled).
- Traces older than 14 days are deleted; raw events in MinIO expire after 1 day; the exporter spool is
  bounded and holds only masked batches.

## Goal: readable bodies (positive visibility)

Prompts, replies, ordinary tool input/output and delegation bodies of Task Board runs must stay readable.
Withholding a whole run only because a tool ran or a secret word was mentioned is a regression.

## Protected (must not be stored or sent)

1. Known secret sources, not collected: credential/token/password/key files, environment dumps, cluster
   secrets and credential commands (`withhold-output?`, `env-dump?`). The call is sent without its body and
   the later model bodies of the run are withheld.
2. Known formats, masked in every field before the batch is spooled: private keys, auth headers, URL
   credentials, JWT, provider keys, bearer tokens, secret-named assignments / flags / env entries / XML
   elements / YAML blocks, high-entropy strings, values of this process's environment.
3. Values pinned from 1-2 and from prose that names a value with a secret word and a copula or separator
   ("the password is huntertwo", "kiwimango is my password", plain lowercase too) are masked in every later
   field of the run, in their escaped and encoded forms.
4. Fail-closed: a value too short to pin (under 4 characters: "password: 123", "the password is abc"), a
   field too large to scan or a scan error withholds that body and the later model bodies with a non-body
   reason (`body_policy`). A final scan of the serialized batch drops a span that still matches.
   Known over-withholding: an ordinary sentence with a short word after a secret word and a copula
   ("Your password is too short.") in tool output.

## Accepted residual (approved by the Owner, not a regression)

- A secret with no label, no known format and no known source: e.g. a bare password stored in a file
  with an ordinary name (`notes.txt`, `app.conf`) and read by a tool. Nothing distinguishes it from
  ordinary text, so the tool output is sent and a later repeat by the model is sent. The Owner accepted
  this for the self-hosted, Owner-only Langfuse (TD-07); the exporter must not go back to withholding all
  tool output, nor try to prove zero leakage by enumerating more representations.
- Unknown transformations (base32, rot13, paraphrase) of a pinned value, and a secret word written apart
  from its value (`API key` with a space, a value far from its label).
- Not in scope of this acceptance: collecting raw credentials on purpose, sending unprocessed fields,
  sending bodies outside the cluster. A new miss of a known source or known format is a regression.

## 追記 (arch#14503 P0 :272 / :580)

- 秘密名ファイル(password/secret/credentials/passphrase)を読む読取系コマンド(cat/head/tail/less/bat/nl/od/xxd/strings/base64/source 等)は、その引数が末尾でなくても機密源として本文を保留する(`cat password /tmp/other`)。`grep`/`rg`/`echo` 等の検索・言及は対象外で読める。
- tool 入力の散文で秘密語に名指しされた値(`echo the password is huntertwo`)も出力と同様に pin し、出力と以後の本文でマスクする。4文字未満なら `value_exposure` で保留。
- 過剰マスク: 入力で秘密語の後に区切り(is/:/=)で続く普通の語も以後マスクされる。

## 追記 (arch#14503 P0 :272 再)

- 秘密語がファイル名の一部にある場合(`cat db_password`、`cat app-secret`、`cat aws_credentials`、`head ./conf/mysql_root_password.txt`)も、読取系コマンドの引数なら機密源として本文を保留する。`grep -rn db_password src` や `echo set db_password` などの検索・言及は対象外で読める。
- 過剰保留: 秘密語を名前に含む普通のファイルの読取(`cat secretary.txt`)も保留する。読取系コマンド以外(`python db_password` 等)の実行出力は対象外で、既知形式/秘密語マスクのみ(許容残差)。
- ファイル系tool(Read/NotebookRead 等)がJSON引数でパスを受ける場合(`{"file_path":"db_password"}`、`{"path":"aws_credentials"}`)も、パス値のキー(file_path/path/notebook_path/filename/file/target_file)の最後の要素に秘密語があれば機密源として本文を保留する。`{"pattern":"db_password"}` のような検索語や、コマンド文字列中の言及は対象外。過剰保留: Glob/Grep の `path` が秘密語を含むディレクトリ名(`src/secrets_manager`)なら一覧/検索結果も保留する。

## 追記 (arch#14503 P0 :280 / :541)

- 読取コマンドの列挙をやめ、反転した: シェルの各セグメント(`;`/`&`/`|`/改行/`$(`/括弧/backtick で分割、引用符内の区切りでは分割しない)で、プログラムが言及専用コマンド(echo/printf/git/ls/find/gh/mkdir/rm/mv/chmod/stat/wc/cd 等)以外なら、秘密名ファイルを丸ごとの引数として受け取った時点で機密源とする(`sed -n 1p db_password`、`awk 1 db_password`、`jq . credentials.json`、`python3 show.py db_password`)。`< db_password` の入力リダイレクト、`dd if=`、`open('db_password')` 等のファイル open 呼出し、`/dev/stdout` への複写も同様。
- `grep`/`rg` 等は最初の非オプション引数(検索語)だけを言及とみなし、2つ目以降の引数や `-e`/`-f` 使用時の秘密名ファイルは機密源(`grep . db_password`)。 検索語をオプションに結合した形(`grep -ex db_password`、`-iex`、`-fpats.txt`、`--regexp=x`、`--file=…`)も検索語の引数が残らないため、全引数をファイルとみなし秘密名ファイルは機密源。e/f を含む短いオプション群は一律この扱いで、`ag -f` 等の過剰保留を許容する。
- JSON の tool 入力は `command`/`cmd`/`script`/`code` の値だけを見る(Bash の `description` が password に言及しても読める)。空白を含む引用符引数(`--note '...'`、commit message)はファイル名とみなさない。
- 散文では行内の全ての秘密語を見る(最初の1語だけではない)。`Reset your password; kiwimango is my token` の `kiwimango` も pin する。
- 過剰保留: 秘密語を名前に含む普通のファイルを任意のプログラムに渡すと保留(`make reset-password`、`kustomize build overlays/secrets`)。残差: 引用符内の任意コード中の非 open 系読取(`python3 -c "import x; x.load_it('db_password')"` 等)は未検出(変数への代入 `f=db_password` は機密源として保留する)で、既知形式/秘密語マスクのみ。

## 追記 (arch#14503 P0 :296)

- `git`/`gh`/`find`/`fd` を一律に言及専用とせず、ファイル内容を出力しない形だけを言及専用とする(既定で拒否)。`git` は内容を出力しない subcommand(add/commit/status/push/pull/fetch/branch/switch/checkout/restore/rm/mv/reset/init/clone/remote/tag/merge/rebase/cherry-pick/revert/worktree/rev-parse)で、かつ `-p`/`--patch`/`-i`/`-v`/`-u` 等を伴わない場合だけ言及専用。`git show HEAD:db_password`、`git cat-file -p`、`git diff`/`log -p`/`blame`/`grep`/`archive`/`config -f`、未知の alias、`git add -p db_password` は機密源。`gh api`/`gist`/`release` 等、`find -exec`/`fd -x` も機密源。`command` は前置き(`command cat db_password`)として扱う。
- 過剰保留: `git log -- db_password` のように内容を出さない読取系 subcommand も、秘密名ファイルを引数にすると保留する。
- token/tokens も秘密語として同じ扱いにする(P0 arch#14503 :273): `cat access_tokens_backup`、`head refresh_token_old`、`sed -n 1p api-tokens-2024`、`{"file_path":"access_tokens_backup"}` は機密源。ラベルも既知形式もない裸のトークンが入るため。`grep -rn access_tokens_backup src`、`echo …`、`git commit -m …` などの言及と、`{"max_output_tokens":…}` のような非パス値は対象外。過剰保留: `cat max_tokens_doc` や `python3 count_tokens.py` のように token を名前に含む普通のファイルの読取も保留する。

## 追記 (arch#14503 P0 :548 / :272)

- 値全体がリテラルや伏字風 (`password: true` / `none` / `null` / `xxxxx` / `****`) でも値として扱う。4 文字以上は pin して以後の本文でマスク、4 文字未満 (`nil` / `***`) は `value_exposure` で保留。名前が toggle/カウンタ (`password_required: true`、`AUTH_DISABLE_PASSWORD=true`、`max_output_tokens: null`、`token_ttl: none`) の場合は設定値として pin しない。過剰マスク: `password: true` を読んだ run では以後 `true` という語が伏字になる。
- 既知の認証ファイル (`~/.npmrc`, `~/.pypirc`, `~/.pgpass`, `~/.my.cnf`, `~/.mylogin.cnf`, `~/.docker/config.json`, `~/.dockercfg`, `~/.boto`, `~/.s3cfg`, `~/.vault-token`, `~/.terraformrc`, `credentials.tfrc.json`, `~/.kube/config`, `~/.yarnrc(.yml)`, `~/.curlrc`, `~/.wgetrc`, `~/.m2/settings(-security).xml`, `gradle.properties`, `~/.config/gh/hosts.yml`, `~/.config/gcloud`, `~/.config/hub`, `rclone.conf`, `~/.azure`, `application_default_credentials.json`, `~/.cargo/credentials`, `~/.gem/credentials`, `.htpasswd`) を機密源とし、その出力と以後の本文を保留する。列挙外の独自形式の認証ファイルは既知の残差 (形式/秘密語マスクのみ)。過剰保留: これらのファイル名に言及するだけのコマンドも保留する。
- Hermes observer (lolice#1091) の `_SENSITIVE_PATH` には本追記の既知認証ファイル列挙をまだ入れていない (本 PR の blocking 対象外)。

## 追記 (arch#14503 P0 :728 / :552)

- 利用者の依頼文(Claude の user 行、Codex の user/developer message)とモデル自身の応答本文も、tool 出力と同じ判定(既知形式/代入/YAML・XML ブロック/散文)で走査する。名指しされた値(`password: huntertwo`、`the password is plumorchard`)は pin し、同じ run の以後の本文と root の出力でマスクする。値を pin できない場合(`password: 123`、`the password is abc`、256KB 超で走査不能)は、その generation 自身の応答も同じ値を再掲し得るため、その generation から後の本文を `withheld_after_secret_exposure` で保留する。
- 値全体が構造語(`password: username`、`token = value`、`{"api_key": "name"}`)でも値として pin する(4 文字未満の `key` 等は保留)。区切りのない平文の複数語の値(`password: value horsestaple`)では構造語も値の一部として pin する。`secretKeyRef: name: … key: …` のような構造の中のキー語、`${VAR}` 等の参照、`Bearer`/`Basic` の認証スキーム語は値としない。
- 誤検出の修正: `date -u +%Y-%m-%dT%H:%M:%SZ` を `curl -u user:pass` と誤認していたため、`-u` の値が `+` で始まるもの・利用者部に `%` に英字が続く日付書式を含むものは対象外にした。`curl -u user%40example.com:pass` のようにパーセント符号化(`%` + 16進2桁)した利用者名は認証情報として扱う(P0 arch#14503 :46)(実 run BOXP-436 で依頼文走査により 8 件が保留される退行を検出し解消)。
- 過剰保留: 依頼文が短いラベル付き例示値を引用する run(本票 BOXP-428 自身の runner prompt は Notes に `password: 123` 等を含む)は、最初の generation から本文が保留される。`Your password is too short.` のような依頼/応答も短い語を名指しするため以後の本文を保留する。過剰マスク: `password: username` を見た run では以後 `username` という語が伏字になる。
- 実 run の比較(件数のみ、本文は出力していない): BOXP-436 sent 25 / BOXP-437 sent 5 は変更前と同一、BOXP-438/440/446/449/450 も変更前と同一。BOXP-428 の直近 run は sent 2 → 0(上記の過剰保留)。

## 追記 (arch#14503 P0 :48 / :1130)

- `curl -u +admin:huntertwo` のように `+` で始まる利用者名も認証情報として扱う(P0 :48)。`-u` の後で対象外にするのは日付書式 `+%` + 英字(`date -u +%Y…`、`'+%H:%M'`)だけにした。
- `curl -u 12345:67890` のように利用者名・パスワードが数字だけの値も認証情報として扱う(P0 :49)。以前は `数字:数字` を時刻とみなして対象外にしていたが、日付書式の除外は `+%` + 英字だけで足りるため撤廃した。
- runner が組み立てる `prompt.md` / `last-message.md`(root span の入力/出力)も依頼文・応答と同じ判定で走査する(P0 :1130)。セッションログが欠落した run ではこの2つが唯一の本文になるため、名指しされた値(`password: huntertwo`、`the password is …`)は pin して root と run 内の全 span でマスクする。pin できない値(`password: 123`、走査不能、値過多)を含む場合は root の入力/出力と run 内の generation/tool 本文を `withheld_after_secret_exposure` で保留し、`coverage.withheld_reason` に理由を残す。
- 実 run 26 件(BOXP-436/437/440/446/449/450、件数のみ)の比較: 子 span の body_policy 件数は修正前後で同一。差分は root に新設した `body_policy=sent` の +1 のみで、root の保留は 0 件。
- 散文で名指しされた値の走査は本文の全行を対象にする(走査対象は呼出し側で 256 KiB に制限)。1 行に調べる上限(64)を超える秘密語がある場合は値を取りこぼさないよう保留する(P0 arch#14503 :726)。
