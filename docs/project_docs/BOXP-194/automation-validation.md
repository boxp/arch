# BOXP-194 自動化検証記録

検証日時: 2026-09-29 UTC
対象コミット: `b59398473a85f30bf498ca7c9425217fe35323dd`

この記録は候補のローカル自動化検証である。Molecule の fixture は実クラスタ、実ノード、実 APT の統合試験を代替しない。本番への dispatch、クラスタ操作、binfmt/QEMU の登録はいずれも行っていない。

## x86_64 Molecule

`ansible/roles/kubernetes_upgrade` で次を実行した。

```console
uv run molecule test
```

結果は exit 0。scenario は `failed=0` で、syntax / create / prepare / check / converge / idempotence / verify / destroy が成功した。Docker はリモートデーモン `tcp://127.0.0.1:2375` だったが、container の作成、Facts 取得、fixture の実行とも成功し、bind mount 起因の阻害は発生しなかった。

`check` は正常な厳密 revision 解決に加え、存在しない revision、到達不能 repository、署名なし repository をそれぞれ拒否し、ホスト APT hook を読まず、隔離 APT 状態を消去することを確認した。converge / idempotence / verify は snapshot の転送サイズ・atomic publish・APT source と mock の健全性を確認した。

既存 scenario に `requirements.yml` / `collections.yml`、`cleanup.yml`、`side_effect.yml` がないため Molecule は missing playbook の警告を出した。また既存の `apt_key` と uv の dev-dependencies に deprecation warning が出た。いずれも今回の失敗ではない。

## ARM64

host と Docker Server は `linux/amd64` / `x86_64` で、Docker context はリモートの `tcp://127.0.0.1:2375` だった。次を実行した。

```console
docker run --rm --platform linux/arm64 geerlingguy/docker-ubuntu2404-ansible:latest uname -m
```

結果は exit 255、`exec /usr/bin/uname: exec format error`。このデーモンには ARM64 実行用の binfmt/QEMU が登録されていないため、`MOLECULE_DOCKER_PLATFORM=linux/arm64 molecule test` は実行していない。環境を変更して回避していない。

PR [#12903](https://github.com/boxp/arch/pull/12903) の historical evidence は、head `7d02c3f9ca09b4971da524ee2706e71ff505947f` に対する 2026-09-28 の `test-ansible / test (kubernetes_upgrade)` 成功である。同 PR の reusable workflow は `ubuntu-24.04-arm` と `MOLECULE_DOCKER_PLATFORM=linux/arm64` を使用する。これは native ARM CI の過去の成功記録であり、現在の対象コミットの ARM64 検証を代替しない。

## 今回の CI 適用範囲

今回の変更は `docs/project_docs/BOXP-194/**` のみである。`.github/workflows/wc-path-filter.yaml` の `test-ansible` path filter は `ansible/**` と test workflow のみを対象にするため、この docs-only PR では Molecule ARM CI が発火しない見込みである。PR の実行結果で未実行なら、本票の ARM gate を通過した証拠として扱わない。

## 関連する親担当の検証

既存automationの対象lint（production profile）は 0 failure / 0 warning、production inventory の syntax check と入力 unit test 3件も成功。Trivy の結果と制限は `validation.md` を参照する。これらは候補package導入の検証ではない。
