# BOXP-228 検証・反映記録

## 現状

archのbootstrap実装と隔離検証が完了。稼働workspaceへの設定適用、merge、image公開、Pod置換は未実施。実装commit `62ae135f216e193cc94b57a2a963c628cade90bb` の通常pushが成功。PR結果はObsidianの本票報告へ記録する。

## 調査証拠

- 調査開始時のarch main: `838eec9fefc0cafd1682a3cad40b3e7438b90e85`。共有checkoutの古いHEADから今回run専用worktreeのみfast-forward。origin/mainは更新せず、明示SSH fetchのFETCH_HEADを使用した。mainはRenovateにより進行するため調査時点を区別する。
- BOXP-227はreviewで終了しclaimなし。本228のみclaimが存在。227 PR #818のhead `77e4ef2b872586f2d89e28aa4400bc31e688bd35`、OPEN/未mergeをAPIで確認。本票では更新・CI再実行なし。
- OSユーザーboxp。標準SSH鍵とknown_hostsが同ユーザー所有・600、SSH configとagentなし。鍵内容は読まず、公開fingerprintと存在/permissionのみ確認した。
- `BatchMode=yes`/`StrictHostKeyChecking=yes`のSSH挨拶はboxp認証成功（GitHubの正常挨拶はexit1）。archへの明示SSH fetch成功。APIのarch permissions.push=trueは補助証拠であり、SSH write完了とは別に扱う。
- gh protocolは既にssh。一方、GitHub HTTPS向けinsteadOf/pushInsteadOfはなし。GitHub credential helperはgh。gh protocolは既存HTTPS URLを置換しないため、HTTPS remoteやdotfilesの固定HTTPS cloneはOAuth Git transportを選べる状態。
- 現dotfiles setupはGit設定非管理。image/bootstrap所有元はarch、HOMEの永続化とdeployment所有元はlolice。
- GitHub APIの現deploymentはreplicas1、Recreate、workspace image latest、HOME PVCを複数サービスで共有。main merge後のimage公開とimage updaterがPod更新に繋がり得る。
- runnerは既存ローカルrepoからrun用worktreeを作成する。archに.gitmodules/LFS ruleなし、tracked依存manifestにGit URL参照なし。manifest外のprivate dependencyや将来のLFS/submoduleは未検証。

## 反映時点とrollback

本run自身がこのPodのrunner claimを保持するため、自己置換はしない。claim終了後に外部制御担当が正規runner停止/prepare-shutdownと全claim解放を確認し、成果とrunner状態を保存してから反映する。lock強制解除、強制中断、全サービスrolloutは行わない。

反映前にworkspaceユーザーのGit configから変更対象キーとimageの直前digestを非秘密の復旧点として保存する。includeだけを除去してから直前imageへ戻す。旧imageにwrapperがない状態でincludeを残すとSSH Gitが停止するため、設定rollbackを先に行う。既存remote・helper・SSH鍵・known_hosts・subscription認証を変更しない。

workspaceユーザーとして以下を実行する（通常のHOMEを使用し、稼働Git操作/claim終了後に行う）。キーを完全一致で除去するため他includeは維持される。

```bash
config="${XDG_CONFIG_HOME:-$HOME/.config}/git/config"
include="$HOME/.local/share/codex-workspace/github-git.inc"
git config --file "$config" --fixed-value --unset-all include.path "$include"
rm -- "$include"
```

その後、外部制御側で記録済みの直前image digestへ戻し、同じPVC・既存鍵の状態で新Podを検証する。URL rewriteを除去するとHTTPS originは従来のOAuth/helperを再び使用する。SSH originは元のまま。

## 実装と検証結果

- imageに専用helperを同梱。entrypointのユーザー設定段階でboxp/HOMEを明示し、dotfiles sync前に実行する。seed-onlyとno-op sidecar経路は従来どおり。
- 標準XDG Git configへ専用includeを一度だけ追加。既存設定を上書きしない。HTTPSの`github.com/` URLだけを`ssh://git@github.com/`へrewriteし、raw remoteは維持する。
- helperがGitHubとGitHub SSH aliasへBatchMode/StrictHostKeyChecking=yesを付与する。他hostでは通常ssh引数を維持する。既存SSH設定、鍵、agent、known_hostsをそのまま利用する。
- 起動ごとに正常HOME/XDG/専用ファイル/既存core.sshCommand/URL rewrite/nested includesを再確認し、競合時は具体的理由で停止する。通常Git configを無効化するGIT_CONFIG_GLOBAL overrideを拒否する。
- 成功したfixture: 実Git clientとローカルbareへのSSH mock橋渡しによるclone/fetch/pull/push、新worktree fetch、新HOME bootstrap、冪等性、alias strict、他host引数保持、raw HTTPS remote維持、SSH host拒否時にHTTPS fallbackなし。既存/後付け/nested競合、不正HOME/XDG、外部XDG、override、malformed configも拒否。
- 実GitHub: 隔離HOMEへ2回bootstrap後、既存鍵と信頼known_hostsを利用しHTTPS形式arch URLからclone、fetch、新worktree fetchの3操作が成功。SSH shimログはtransport=ssh/host=github.comだけに限定、鍵のコピー・global設定変更なし。
- 既存task-board runner回帰テスト、recurring-eventsテスト、bash構文、actionlint成功。recurring-eventsのsudo依存ownership caseは環境制約でskipされ、passedと区別する。
- 対象変更ファイルのgitleaks findings=0。codex-reviewの独立レビューは指摘なし（最終commit後の追加結果はObsidian報告を参照）。

## 残る制約

本票の実writeは隔離HOMEのbootstrapを使い、HTTPS形式URLから実装branchへ通常pushして確認済み。ログはSSH/GitHub/strict/batchだけ。remote headは`62ae135f216e193cc94b57a2a963c628cade90bb`（最初の実装push時点）。workflow writeは227で同じworkspace/account/keyを利用したPR #818の成功証拠を参照する。SSH鍵にはOAuth workflow scopeはなく、read/挨拶だけでworkflow writeを完了扱いにしない。

再bootstrapと新HOMEは検証済みだが、実image再build/実Pod再作成後の継続性は未検証。鍵とhost信頼が未提供ならSSH自体が停止し、HTTPSへfallbackしない。gh PR/APIは通常HOMEの既存OAuthを使用し、subscription認証を変更しない。LFSの別HTTP endpointやmanifest外のprivate dependency、明示的なrepo/env/command-line transport overrideは今回の検証範囲外。
