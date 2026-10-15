# cache-sentinel

DSH (DeepSeek Harness) 用 Host プラグイン。最後のセッション更新から一定時間(既定 60 分)を超えたセッションを自動でアーカイブする。
アーカイブ済みセッションは GUI で開けなくなる(内容を見るにはアーカイブ解除が必要)ので、プロンプトキャッシュが切れた後の誤送信で
通常のインプット料金が発生することを防げる。アーカイブは GUI から解除できる。

状態: 実装済み・実機検証済み(T9: 選定、アーカイブ、解除後の猶予、設定のライブ反映)。仕様は [docs/spec.md](docs/spec.md)、調査は [docs/spike.md](docs/spike.md)。

## 動作の要点
- 60 秒ごとにチェックし、アイドルが `idleMinutes` を超えたトップレベルのセッションをアーカイブする。
- ピン留め(アーカイブするとピンが外れる)、サブエージェント、実行中の作業があるセッションは対象外。実行中のものは終了後に対象になる。
- 初回有効化より前から止まっているセッションは対象外(`archiveExisting: true` で対象にできる)。
- 手動でアーカイブを解除すると、その時刻から `idleMinutes` の猶予がある。
- 最終更新時刻はセッションログの mtime(ロード済みなら末尾イベント時刻との大きい方)。

## 導入
```sh
pnpm install && pnpm test && pnpm run build
pnpm pack                       # cache-sentinel-<version>.tgz ができる
dsh plugin --profile web add file:$PWD/cache-sentinel-<version>.tgz
```
DSH を再起動すると有効になる。まず `dryRun: true` で対象をログで確認することを推奨。

## 設定 (`cordis.patch.yml` の `config:`)
| キー | 既定 | 意味 |
|---|---|---|
| `idleMinutes` | 60 | アイドルしきい値(分) |
| `checkIntervalSeconds` | 60 | チェック間隔(秒、10 以上) |
| `skipPinned` | true | ピン留めを除外 |
| `archiveExisting` | false | 初回有効化より前に止まったセッションも対象にする |
| `maxPerCycle` | 20 | 1 サイクルの上限 |
| `dryRun` | false | ログのみ(アーカイブしない) |
| `stateFile` | `$DSH_HOME(~/.dsh)/cache-sentinel/state.json` | 永続状態 |

## ログ
`journalctl --user -u deepseek-harness | grep cache-sentinel`。DSH の `ctx.logger` は出力先がないと捨てられるため、`[cache-sentinel]` 付きで console にも出している。

## 制限
- メッセージのない空のセッション(GUI が自動作成するもの)もアーカイブ対象になる。GUI の一覧には出ないので実害はない。
- セッション保存先は `$DSH_HOME/sessions`(既定 `~/.dsh/sessions`)を前提とする。保存先を変えている場合は mtime が取れず `createdAt` で代用される。
- 設定画面(GUI)とスキーマ公開は未対応。
- アーカイブを解除して再送信した最初の 1 回は、キャッシュが切れているので通常のインプット料金になる。

## 開発
`scripts/dsh-rpc.mjs <namespace/method> '<request JSON>'` で DSH の RPC を直接呼べる(例: `workspace/unarchiveSession` `{"sessionId":"..."}`)。
journal の起動 URL からトークンを読むため、systemd で動かしている環境専用の検証用スクリプト。
`pnpm test`(node:test)/ `pnpm run typecheck` / `pnpm run build`。実装は [docs/implementation-plan.md](docs/implementation-plan.md) の T1〜T9 に沿って進めた。
