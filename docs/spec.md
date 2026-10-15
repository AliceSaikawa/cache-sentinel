# cache-sentinel 仕様 v0.1 (draft)

## 1. 目的
最後のセッション更新から一定時間(既定 60 分)を超えたセッションを自動でアーカイブする。
アーカイブ済みセッションは DSH のゲートで新規ステップ実行が拒否される = 閲覧のみ。
プロンプトキャッシュ失効後の誤送信による、通常インプット料金の発生を防ぐ。

## 2. 用語
- **最終アクティビティ時刻 (lastActivityAt)** = `max(最終イベント time, 手動解除時刻)`
  - 最終イベント time: ロード済みセッションは `Session.ownEvents()` 末尾の `time`(epoch ms)。
    未ロードの永続セッションはセッションログファイルの mtime で代用する。
  - 手動解除時刻: アーカイブ集合からの離脱をプラグインが観測した時刻(§5)。
- **アイドル時間** = `now - lastActivityAt`
- **基準時刻 (baselineAt)** = プラグインが初めて有効化された時刻。`state.json` に永続化(§7)。

## 3. 対象判定 (すべて満たすセッションをアーカイブ)
1. トップレベルセッションである (`header.origin !== 'subagent'`、`parentSession` なし)。
2. 未アーカイブである。
3. ピン留めされていない (`skipPinned: true` の場合)。
4. `lastActivityAt >= baselineAt` (`archiveExisting: false` の場合)。
5. アイドル時間 > `idleMinutes` (既定 60)。
6. 実行中の作業がない(ターン・ジョブ・サブエージェント・リマインダ)。
   - `archiveSession(id)` を `stopActivity` なしで呼び、`WorkspaceActiveSessionError` が返れば
     スキップして次回に回す(エラーではなく debug ログ)。作業を強制停止しない。
   - 6 の判定は archiveSession 自身に任せる(自前の事前判定を持たない)。

## 4. 実行タイミング
- プラグイン有効化時に 1 回、以降 `checkIntervalSeconds`(既定 60)ごとに 1 サイクル。
- 1 サイクルは直列実行。前のサイクルが終わっていなければスキップ。
- 1 サイクルあたりのアーカイブ上限は `maxPerCycle`(既定 20)。残りは次回。
- `dryRun: true` のときは対象を INFO ログに出すだけで archive しない。

## 5. 手動解除の猛予
- 各サイクルで `archivedSessionIds` を前回スナップショットと比較する。
  前回にあって今回ない id = 解除された → `unarchivedAt[id] = now` を記録(メモリ + state.json)。
- プラグイン自身のアーカイブは「自分が追加した id」として別管理し、解除とは混同しない。
- 解除後は `lastActivityAt` が解除時刻以降になるため、そこから `idleMinutes` の猛予が自動で得られる。
- 起動直後の初回スナップショットは差分比較せず、基線として保存するだけ。

## 6. 設定 (config schema)
| キー | 型 | 既定 | 意味 |
|---|---|---|---|
| `idleMinutes` | number (≥1) | 60 | アイドルしきい値 |
| `checkIntervalSeconds` | number (≥10) | 60 | チェック間隔 |
| `skipPinned` | boolean | true | ピン留めを除外(アーカイブするとピンが外れるため) |
| `archiveExisting` | boolean | false | 基準時刻より前に更新が止まったセッションも対象にする |
| `maxPerCycle` | number (≥1) | 20 | 1 サイクルの上限 |
| `dryRun` | boolean | false | ログのみ |
| `stateFile` | string | `<harness home>/cache-sentinel/state.json` | 永続状態 |

## 7. 永続状態 (state.json)
```json
{ "version": 1, "baselineAt": 1791984059116, "unarchivedAt": { "<sessionId>": 1791984059116 } }
```
- 破損・欠落時は `baselineAt = now` で再作成(=過去分は対象外になる安全側)。
- `unarchivedAt` は対応セッションが削除済み or 7 日経過で掃除。
- 書き込みは atomic(temp → rename)。

## 8. 失敗時の振る舞い
- 個別セッションの失敗は warn ログを出して継続。サイクル全体は落とさない。
- 時刻が取れないセッションは対象外(アーカイブしない)。
- 時計が巻き戻った場合(`lastActivityAt > now`)はアイドル 0 として扱う。

## 9. 非目標 (v0.1)
- GUI での通知・設定画面・手動「今すぐアーカイブ」ボタン。
- サブエージェントセッション個別のアーカイブ(親のアーカイブに従う)。
- Claude Code 対応。
- アーカイブ解除後のキャッシュ再温め。

## 10. 受入基準
- A1: 61 分アイドルの未ピン留めセッションが次のサイクルでアーカイブされる。
- A2: 59 分アイドルはされない。
- A3: ピン留め、subagent、実行中ターンありはされない(実行中は後続サイクルで終了後に対象になる)。
- A4: `lastActivityAt < baselineAt` は `archiveExisting: false` でされず、`true` でされる。
- A5: 手動解除直後はアーカイブされず、解除から 60 分超でされる。
- A6: `dryRun` では archiveSession が呼ばれない。
- A7: state.json 欠落/破損で起動してもクラッシュしない。
- A8: archiveSession が例外を投げても他セッションの処理が続く。

## 11. 未確認事項 (実装前に spike で確認)
- U1: `ctx.workspaceRegistry` / `ctx.sessionPersistence` / `ctx.sessionStore` を inject して Host プラグインから使える形。
- U2: 未ロードセッションのログ mtime のパスの取り方(`dsh-home-paths`、`~/.dsh/sessions/<cwd-slug>/<id>/session.v4.jsonl.zstd`)。
- U3: ピン留め集合のプロパティ名(`pinnedSessionIds` 想定)。
- U4: 手動アーカイブ解除を知るイベントの有無。無ければ §5 のポーリング差分で足りる。
- U5: プラグインをプロファイルへ入れる方法(`dsh plugin` + `cordis.patch.yml`、dsh-webui-m3e と同形式)。
