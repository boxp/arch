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
- `curl -u :huntertwo` のように利用者名が空の値も認証情報として扱う(P0 :50)。利用者部は0文字以上とし、`:` 以降をマスクして値をpinする。過剰マスク: `-u` の直後が `:` で始まる他コマンドの引数(稀)も伏字になる。
- `curl -u user%name:huntertwo` のように利用者名に16進2桁でない `%` を含む値も認証情報として扱う(P0 :50 再指摘)。利用者部は空白と `:` 以外の任意の文字列とし、`%` の制限を撤廃した。`-u` の後で対象外にするのは日付書式(`+` の後に引用符を挟んでもよい `%` + 英字: `date -u +%H:%M`、`'+%H:%M'`、`+"%H:%M"`)だけ。過剰マスク: `-u` の直後に `x:y` 形式の引数を取る他コマンド(稀)も伏字になる。
- `curl -u +%admin:huntertwo` のように日付書式の形で始まる利用者名も認証情報として扱う(P0 :50 再々指摘)。`-u` の後で対象外にするのは、引数全体が日付書式の場合だけにした: 英字はすべて `%` 指定子(`%H`, `%-d` 等)かリテラルの大文字 `T`/`Z`、他は記号のみ(`+%Y-%m-%dT%H:%M:%SZ`, `+%FT%TZ`, `'+%H:%M'`)。`%a` の後に英字が続く `+%admin:…` は書式ではない。許容残差: `%` 指定子と記号だけから成るパスワード(`+%a:%b` 等)は日付書式とみなされ伏字にならない。実 run 28 件の body_policy 件数は修正前後で一致。
- `curl -u 'user:my secret'` のように引用符内に空白を含む `-u` の値も、シェルの1語全体を認証情報としてマスクする(P0 :50)。以前は最初の空白までしかマスクせず残りが送信されていた。引用符は `'…'`/`"…"`(\エスケープ可)のどちらでも、`:` が引用符の内外どちらにあってもよく、閉じない引用符は行末まで。pin は引用符を除いた `:` 以降の値全体(複数語の値は他の経路と同じ扱い: 4文字未満の語を含めば value_exposure で保留)。対象外は従来どおり `:` を含まない `-u` 引数(`ls -u 'my notes.txt'`)と日付書式。
- `curl -u user:longpass\ secretvalue` のように引用符なしで `\` エスケープした空白を含む `-u` の値も、シェルの1語として丸ごとマスクする(P0 :55)。pin はエスケープを解いた `:` 以降の値(`longpass secretvalue`)。`user\:x:pass` のようにエスケープした `:` は利用者名の一部として扱う。
- `mysql -p'long password'` / `sshpass -p 'long password'` の `-p` の値も `-u` と同じくシェルの1語として丸ごとマスクし、シェル規則で解決した値全体を pin する(P0 :56)。以前は最初の空白までしかマスクせず、残りと後続本文での再掲が送信されていた。値を付けない `mysql -p`(対話入力)や `ls -p`/`mkdir -p` は対象外。
- JSON のツール入力は `\uXXXX`(任意段のエスケープ)と `\/` を復号した形でも機密源を判定する(P0 :343)。`{"file_path":"db_passw\u006frd"}` は `db_password` を読む呼出しとして本文を保留する。復号した引用符/バックスラッシュはエスケープのまま残しJSONの形を保つ。過剰保留: パス中に文字どおり `\u006f` を含む稀なファイル名も復号後の名前で判定する。
- runner が組み立てる `prompt.md` / `last-message.md`(root span の入力/出力)も依頼文・応答と同じ判定で走査する(P0 :1130)。セッションログが欠落した run ではこの2つが唯一の本文になるため、名指しされた値(`password: huntertwo`、`the password is …`)は pin して root と run 内の全 span でマスクする。pin できない値(`password: 123`、走査不能、値過多)を含む場合は root の入力/出力と run 内の generation/tool 本文を `withheld_after_secret_exposure` で保留し、`coverage.withheld_reason` に理由を残す。
- 実 run 26 件(BOXP-436/437/440/446/449/450、件数のみ)の比較: 子 span の body_policy 件数は修正前後で同一。差分は root に新設した `body_policy=sent` の +1 のみで、root の保留は 0 件。
- 散文で名指しされた値の走査は本文の全行を対象にする(走査対象は呼出し側で 256 KiB に制限)。1 行に調べる上限(64)を超える秘密語がある場合は値を取りこぼさないよう保留する(P0 arch#14503 :726)。

## 追記 (arch#14503 P0 :343)

- 空白を含むファイル名(`sed -n 1p 'db_password backup'`、`db_password\ backup`、`dd if='db_password backup'`、`open('db_password backup')`)も、最後のパス要素が秘密語(password/passphrase/secret/credentials/token)を含めば機密源として本文を保留する。以前は空白を含む引数を一律に文章とみなして除外していた。
- シェルの語の切り方を実際のシェルに合わせた: 隣接する引用部分と裸の部分は1語に連結し(`if='a b'`)、バックスラッシュによるエスケープ(`\ `)を解決する。
- 文章を値に取るオプション(`--note`/`-m`/`--message`/`--body`/`--title`/`--description`/`--comment`/`--summary`/`--subject`/`--reason`/`--evidence`)の直後の空白入りの値は従来どおり文章として読める(Task Board の append-note、commit message、PR 本文)。
- 過剰保留: 任意のプログラムに、秘密語を含む引用文を通常の引数として渡した場合(`python3 x.py "the password flow"`)はその出力を保留する。

- 走査上限の fail-closed (P0 arch#14503 segment-reads-secret-file?): 1セグメント512語、256セグメント、open() 呼出し256件を超えるコマンドは、上限より後ろを走査しない代わりに全体を機密源として扱い本文を保留する（`sed -n 1p <512個の引数> db_password` を防ぐ）。過剰保留: 上限を超える長いコマンドは通常ファイルだけを読む場合でも出力本文が保留される。
- 秘密名ファイルの名前の長さ (P0 arch#14503 secret-file-name): 秘密語の後ろの部分は以前 `[A-Za-z0-9_.-]` 64文字までしか見ておらず、`cat db_password<65文字以上>` や `db_password+backup` 等が機密源にならなかった。最後のパス要素の残り(区切り・空白以外の任意文字、ファイル名上限の255バイトまで)を受け付ける。シェル引数・読取コマンド・JSON の file_path すべて同じ。過剰保留: `python3 x.py token=abc` のように秘密語の後に `=` や `:` が続く引数も秘密名ファイルとみなし保留する。

## 追記 (arch#14503 P0 :343 グロブ)

- 読取コマンドの引数・`<` リダイレクト・`dd if=` に、秘密語を綴る、または秘密語の一部(3文字以上)をワイルドカードの隣に置いたグロブ/ブレース展開がある場合は、展開先が秘密名ファイルになり得るため機密源として本文を保留する(fail-closed): `cat db_password*`、`cat db_pass*`、`sed -n 1p *word`、`awk 1 ?b_password`、`cat pass[w]ord`、`cat cred*`、`cat db_pass{word,}`、`cat {db,app}_password`。
- 引用符内・エスケープしたワイルドカード(`jq '.[0]'`、`python3 -c 'print(a[0])'`)、URL、グロブのフィルタ値(`rg -g '*.py'`、`--glob`、`--include`、`find -name`)、言及専用コマンド(`ls db_*`、`echo *`)は対象外。
- 許容残差(TD-07): 見えている文字に秘密語が現れないグロブ(`cat db_*`、`cat ./conf/*`、`cat src/*.py`)は、`cat $f` や `xargs cat` と同じく実際に読むファイル名がコマンドに現れないため検出しない。一律に保留すると実 run の可視性が大きく落ちる(試算: BOXP-436 の run で sent 26→6、BOXP-440 で 42→3。主因は `grep -rn x dir/*.bb` のような通常のグロブ読取)ため採らない。
- 実 run 28 件(BOXP-436/437/440/446/449/450、件数のみ)の body_policy 件数は修正前後で完全一致。

## 追記 (arch#14503 P0 :639 / :421)

- 値の中に秘密語を含むもの(`password: mysecret123`、`token = my-token-value`)も値として pin する(P0 :639)。以前は秘密語を含む語を一律に名前とみなして除外していた。名前として除外するのは秘密語単体(`password`、`api_key`、`secrets`)と、非 ASCII で秘密語を含む語(`トークン数`)、構造の中で `:`/`=` が続くキー語(`secretKeyRef: name: app-secrets`)だけ。過剰マスク: 値位置に置かれた名前(`password = DB_PASSWORD`)は以後同じ run で伏字になる。
- pin 値・環境変数値の符号化された再掲は、符号化の種類を列挙せず、本文中の Base64/base64url/hex らしい連続を復号して値を探す(復号開始位置を Base64 は 4 通り、hex は 2 通り試すため、長い符号化文字列の途中に値があっても検出する)。見つかればその連続ごと `[REDACTED:env]` にし、最終ガードも同じ処理で再検査する。4 文字未満の値は乱数的な復号結果に一致するため復号側では探さない。普通の Base64(`aGVsbG8gd29ybGQ=`)や英文はそのまま読める。
- 符号化文字の連続は長さの上限なしで1つの連続として扱う(以前は 65,536 文字で分割され、境界をまたぐ値の符号化がどちらの断片でも見つからなかった。P0 arch#14503 :260)。4,194,304 文字を超える連続は復号せず丸ごと `[REDACTED:env]` にする(fail-closed、pin 値がある場合のみ)。
- 許容残差(TD-07): base32、rot13、gzip、二重符号化、大文字化、言い換えなど上記以外の変換は検出しない。
- 既知の認証ファイルは、シェルが引用符・エスケープを連結した後の語でも判定する(P0 :421): `cat ~/.npm''rc`、`cat ~/.np\mrc`、`cat ~/'.npmrc'`、`bash -lc "cat ~/.npm''rc"`。照合は語全体またはパス要素単位で、引用を含む語だけを再走査するため、引用付き引数の連結で別の語と融合した文字列(`rg 'x' a.bb",max_output_tokens`)をファイル名と誤認しない(最初の試作では全体照合で実 run BOXP-436 の sent 33→3 となる退行を検出し、語単位へ変更した)。
- 処理量: 200KB の Base64 連続で約 40ms、2 万個の短い Base64 語 + 500 値で約 1.1 秒(非同期の exporter 内)。
- 実 run 28 件(BOXP-436/437/440/446/449/450、件数のみ)の body_policy 件数は修正前後で完全一致。

## 追記 (arch#14503 P0 :719)

- 値全体が秘密語単体(`password: secrets`、`token = credentials`、`{"api_key": "passphrase"}`、`the password is secrets`)の場合も、その語を値として pin する(以前は参照扱いで除外し、後続本文の裸の再掲が送信されていた)。4 文字未満(`password: pwd`)は value_exposure で保留。`${PASSWORD}` などの参照、長い値の中の名前、env エントリの変数名(`PASSWORD=...` の `PASSWORD`)は従来どおり値としない。
- 過剰マスク: `password: secret` や `password: <secret>` のような説明・雛形を読むと、以後同じ run で `secret` などの語が伏字になる(保留はしない)。
- 実 run 28 件(BOXP-436/437/440/446/449/450、件数のみ)の body_policy 件数は修正前後で完全一致。

## 追記 (arch#14503 P0 secret-file-word?)

- ハイフンで始まる秘密名ファイルも、必ずファイル名になる位置では機密源として扱う: オプション終端 `--` の後の被演算子(`sed -n 1p -- -db_password`、`grep -h x -- -db_password`、`grep -- -x -db_password` の2つ目以降)、入力リダイレクト(`< -db_password`、`<-db_password`)、`dd if=-db_password`、変数代入(`f=-db_password`)、`open('-db_password')`。以前は先頭 `-` の語を一律にオプションとみなして除外し、ラベルのない秘密値が送信されていた。
- `--` より前の先頭 `-` の語は従来どおりオプションとして扱う(`--password-file=x.cnf`、`--token-ttl 5` で保留しない)。grep/rg で `--` の直後の最初の被演算子は検索語のまま(`grep -rn -- -password src` は読める)。`echo`/`ls` 等の言及専用コマンドも対象外。
- 実 run 28 件(BOXP-436/437/440/446/449/450、件数のみ)の body_policy 件数は修正前後で完全一致。

## 追記 (arch#14503 P0 :910)

- 秘密語＋区切りで名指しされた値が複数語で、その中に秘密語単体が含まれる場合(`the password is secrets and valid`、`password: secrets valid`、`token = credentials horsestaple`)も、その秘密語を値の一部として pin する。以前は後続の語(valid)だけを pin し、秘密語(secrets)は名前として除外していたため、後続本文の Base64 形(`c2VjcmV0cw==`)や裸の再掲が送信されていた。pin した語は既存の復号照合(Base64/base64url/hex)でも検出される。
- 構造値(`secretKeyRef: {name: ..., key: password}`)のキー語の扱い、区切りのない言及(`Reset your password ...`)は従来どおり。4 文字未満の秘密語(`pwd`)が値の中にある場合は value_exposure で保留。
- 過剰マスク: `the password is stored in the secrets manager` のような説明文を読むと、以後同じ run で `secrets` も伏字になる(保留はしない)。
- 実 run 28 件(BOXP-436/437/440/446/449/450、件数のみ)の body_policy 件数は修正前後で完全一致。

## 追記 (arch#14503 P0 :781)

- 値が認証方式名と一致する場合(`curl -u admin:bearer`、`password: digest`、`the password is bearer`)も、その語を値として pin する。以前は方式名(https/basic/bearer/digest/negotiate)を値から一律に除外していたため、後続本文の裸の再掲や Base64 形が送信されていた。
- 区切りのない複数語の値の中の方式名(`curl -u 'admin:horsestaple bearer'`、`password: secretvalue basic`)も値の一部として pin する。ただし資格情報の先頭に置かれた方式名(`Authorization: Bearer xyz`、`the token is Bearer xyz`)は方式であり値ではないため、従来どおり後続の資格情報だけを pin する。
- 過剰マスク: 方式名がパスワードとして現れた run では、以後同じ run で `bearer` 等の語も伏字になる(保留はしない)。
- 実 run 28 件(BOXP-436/437/440/446/449/450、件数のみ)の body_policy 件数は修正前後で完全一致。

## 追記 (arch#14503 P0 :933)

- 秘密語より前に置かれた値(`username is my password`、`value is my token`、`null was my api_key`)が構造語・リテラル・方式名と一致する場合も、その語を値として pin する。以前は秘密語の前の語を `reference?`(構造語/停止語を含む)で除外していたため、後続本文の裸の再掲や Base64 形が送信されていた。秘密語の前で除外するのは変数・プレースホルダー・秘密名(`reference-only?`)と疑問詞・接続語(what/it/this 等)だけにした。
- 4 文字未満の語(`key is my password`)は pin できないため従来どおり value_exposure で保留する。
- 過剰マスク: `Name is your password.` のような文を読むと以後同じ run で `Name` 等の語が伏字になる(保留はしない)。
- 実 run 28 件(BOXP-436/437/440/446/449/450、件数のみ)の body_policy 件数は修正前後で完全一致。
- 認証情報フィールド(curl -u / --user、mysql -p、sshpass -p、URL userinfo)のパスワードは1つの不透明な値として丸ごとpinする。`:` や `=` を含んでも構造(キー/値)として分解しない(`curl -u admin:apple:true` の `apple:true`、P0 arch#14503 :781)。4文字未満は value_exposure で保留、`$PASS`/`${TOKEN}` 等の変数参照は値としない。
- `-u` の値はシェルと同じ規則で1語として解決してからpinする(単一引用符は中身そのまま、二重引用符内は `\"` `\\` `\$` `` \` `` のみ解決、引用外の `\` は次の1文字、閉じない引用は末尾まで)。引用符を一律に削除すると `curl -u "admin:plum\"orchard"` で `plumorchard` をpinし、実際の値 `plum"orchard` の再掲が送信されていた(P0 arch#14503 :781)。解決後の値は前後の引用符も削らずそのままpinする。
- `env` に何らかのオプションが付いた呼出し(`env -u HOME`、`env -C dir`、`env --unset=HOME`)は環境変数ダンプ(機密源)として保留する。Hermes observer の `_ENV_DUMP` と同じ規則。従来はオプション引数(`HOME`)が代入でも終端でもないため判定を通過し、出力に `HOME=` も無いため出力側の判定も通過して、秘密語のない変数名の値が送信されていた(P0 arch#14503 :336)。過剰保留: `env -i cmd` / `env -S 'cmd'` のように env 経由でコマンドを実行する呼出しの出力も保留する。`env LANG=C ls` と `/usr/bin/env python3` は従来どおり読める。
