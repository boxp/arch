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
