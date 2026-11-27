# ticket lock の TLA+ / TLC による限定検証（BOXP-732）

Task Board runner の ticket lock（取得・heartbeat・解放・期限切れ回収）を TLA+ で書き、TLC で
**Runner 2 台・チケット 1 枚** の全ての交互実行を調べる。比較の基準は Lean のモデルと再生テスト
（[../lock-model/README.md](../lock-model/README.md)、BOXP-650）。

- 試行の結果・Lean との比較・保守負担: [docs/project_docs/BOXP-732/plan.md](../../../docs/project_docs/BOXP-732/plan.md)
- **CI の必須 check ではない**（どの workflow からも呼ばない）。手元で `run-tlc.sh` を動かす。

| ファイル | 役割 |
|---|---|
| `TaskRunnerLock.tla` | モデルと性質。BOOLEAN 定数で「実装どおり」「正しい版」「意図的に壊した版」を切り替える |
| `run-tlc.sh` | 版 × 性質を全部 TLC にかけ、`expected.tsv` と比べる（違えば終了コード 1） |
| `expected.tsv` | 期待する結果。**TLC を動かす前に**モデルと実装を読んで書いたもの（TLC の出力を写していない） |
| `repro-stale-runner-commit.sh` | TLC の反例（下の C1）を runner の実装で再現する観察用スクリプト。CI の case には入れていない |

## Lean のモデルとの違い（何を足したか）

Lean のモデルは操作を **1 つずつ順に・一瞬で** 行う。TLA+ のモデルは次を足した。

1. **操作の途中に他の Runner が割り込める**。`GuardedAcquire` / `GuardedHeartbeat` を FALSE にすると、
   取得は「確認」と「書き込み」、heartbeat は「読む」と「書く」の 2 手に分かれる。TRUE が実装
   （`with-ticket-lock-guard` の中で 1 手）。
2. **run 本体（agent の作業と、終わりの lifecycle commit）**。Lean のモデルは lock ファイルと owner の状態だけで、
   run 本体が lock を失った後どうするかを持たない。
3. **一時停止と復帰**。TLA+ の交互実行では、ある Runner の操作が選ばれない間は「止まっている」のと同じなので、
   JVM の一時停止・ネットワーク断・heartbeat thread の遅れは特別な操作なしで全部含まれる。

逆に、計画停止の印・再起動・owner の状態（Lean の規則 4・6・7・8・9）は **このモデルにない**（下の「扱わないもの」）。

## 版

| 版 | heartbeat の所有確認 | 解放の所有確認 | 奪うのは期限切れだけ | 取得を guard 内 1 手 | heartbeat を guard 内 1 手 | commit 前の所有確認 |
|---|---|---|---|---|---|---|
| `impl`（実装どおり） | ○ | ○ | ○ | ○ | ○ | × |
| `fenced`（正しい版の案） | ○ | ○ | ○ | ○ | ○ | ○ |
| `bad-hb-owner` | × | ○ | ○ | ○ | ○ | × |
| `bad-release-owner` | ○ | × | ○ | ○ | ○ | × |
| `bad-take-fresh` | ○ | ○ | × | ○ | ○ | × |
| `bad-acquire-unguarded` | ○ | ○ | ○ | × | ○ | × |
| `bad-hb-unguarded` | ○ | ○ | ○ | ○ | × | × |

## 性質

| 名前 | 中身 | 種類 |
|---|---|---|
| `NoForeignDisplace` (L1) | 期限内の lock を持ち主以外が書き換え・削除しない。期限切れの lock を持ち主以外が変えるのは、削除か自分の新しい lock にするときだけ | 行動の性質 `[][..]_vars` |
| `HeartbeatOnlyOwn` (L2) | lock の heartbeat 時刻を進めるのはその lock の持ち主だけ | 行動の性質 |
| `AtMostOneRightfulHolder` (L3) | 持っているつもりで正しい Runner は高々 1 台 | 不変条件 |
| `CommitOnlyByHolder` (C1) | lifecycle commit（lane・Notes・summary）をするのは、その時点で lock を持っている run だけ | 不変条件 |
| `SingleWorker` (C2) | 同じチケットの run が 2 台で同時に進んでいない | 不変条件 |
| `NoProgressAfterTakeover` (S1) | 空回りの確認。「他 Runner の lock を奪った後に、正しい持ち主が commit まで進む」ことは起きないとわざと主張する。全ての版で違反（= そこまで届く）が期待値 | 不変条件 |

`TypeOK`（型と `hb <= now`）は全ての検査で一緒に調べる。

## 結果（`expected.tsv`、small・large とも一致）

| 版 | L1 | L2 | L3 | C1 | C2 | S1 |
|---|---|---|---|---|---|---|
| `impl` | ok | ok | ok | **違反** | 違反 | 違反（届く） |
| `fenced` | ok | ok | ok | ok | 違反 | 違反（届く） |
| `bad-hb-owner` | 違反 | 違反 | ok | 違反 | 違反 | 違反 |
| `bad-release-owner` | 違反 | ok | ok | 違反 | 違反 | 違反 |
| `bad-take-fresh` | 違反 | ok | ok | 違反 | 違反 | 違反 |
| `bad-acquire-unguarded` | 違反 | ok | ok | 違反 | 違反 | 違反 |
| `bad-hb-unguarded` | 違反 | ok | ok | 違反 | 違反 | 違反 |

- `impl` の C1 違反は実装の挙動で、`repro-stale-runner-commit.sh` で再現した（`observed: unfenced`）。
- C2 は lease 方式の lock の限界で、commit の前に所有を確かめても、止まっていた旧 Runner の agent の作業は止まらない。
- L3 はどの版でも ok。lock が 1 ファイルなので「正しく持っている」のは常に 1 台で、壊れた版の害は L1（他人の lock を消す・上書きする）として出る。

## 大きさと時間（2CPU、TLC 1 worker）

| 大きさ | 定数 | 正しい版の状態数 | 42 検査の合計 |
|---|---|---|---|
| `small`（既定） | StaleAfter=2, MaxTime=7, MaxGrants=3 | impl 25,360 / fenced 16,667 | 約 45 秒 |
| `large` | StaleAfter=3, MaxTime=10, MaxGrants=4 | impl 146,769 / fenced 91,587 | 約 2 分 40 秒 |

どちらも状態空間を **全部** 調べ終えている（TLC の `No error has been found` は、その定数の範囲で全ての交互実行を見たという意味）。
large でも結果は small と同じで、反例の手数が 1〜2 手伸びるだけだった。

## 扱わないもの

- **計画停止の印・再起動・owner の状態**（Lean の規則 4・6・7・8・9）。Lean の側で見ている。
- **自分の lock を自分で奪わない規則**（Lean の規則 5）。1 台の Runner の中で同じチケットの run を 2 本並べる場面をモデルに入れていない。
- 時刻は整数の刻みで、`StaleAfter` は 2 か 3。実際の 180 秒・1 秒ごとの heartbeat の比は扱わない（刻みの大きさではなく「期限内か・切れたか」の順序だけを見ている）。
- **壊れたファイル**、`close-stale-lock!` が書く Notes・summary、lane の移動の中身。
- `with-ticket-lock-guard` が本当に排他になること（JVM 内の `locking` と PVC 上の `FileLock`）。モデルは guard 内の処理を 1 手と仮定しているだけ。
- Runner 3 台以上、チケット 2 枚以上、`MaxGrants` を超える回数の取り直し。
- 活性（いつか必ず取れる）。時計に上限があるので調べていない。
- **実装との照合は自動ではない**。モデルの操作と実装の関数の対応は人が読んで決めた（冒頭のコメントと上の表）。
  Lean のように手順を実装へ流す再生テストはない。実装で確かめたのは `repro-stale-runner-commit.sh` の 1 件だけ。

## 再現

```sh
cd tests/codex-workspace/tla-lock-model
./run-tlc.sh --fetch /tmp/tla                      # tla2tools.jar v1.7.4（sha256 を確認）
JAVA=/path/to/java TLA2TOOLS_JAR=/tmp/tla/tla2tools.jar ./run-tlc.sh          # small
JAVA=/path/to/java TLA2TOOLS_JAR=/tmp/tla/tla2tools.jar ./run-tlc.sh large    # large
./repro-stale-runner-commit.sh                     # bb だけ。約 15 秒
```

Java は 11 以上（試行では Eclipse Temurin 21.0.13.1 JRE）。反例の全文は `TLC_OUT`（既定は一時ディレクトリ）の
`<版>.<性質>.out` に残る。

## モデルを変えるとき

1. 実装の変更がどの操作・性質に当たるかを先に決め、`TaskRunnerLock.tla` を直す。
2. **TLC を動かす前に** `expected.tsv` を直す（期待値は実装やTLCの出力から写さない）。
3. `run-tlc.sh` と `run-tlc.sh large` が一致することを確かめる。S1 が ok になったらモデルが空回りしている。
4. この README の表を直す。
