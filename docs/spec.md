# cache-sentinel 仕様 v0.4 — モード切り替え (draft)

## A. モード
| モード | 動作 |
|---|---|
| `block`(既定) | 入力禁止(閲覧のみ)。本書 §1〜§9 |
| `archive` | `idleMinutes` を超えたセッションを自動アーカイブ。[archive-spec.md](archive-spec.md) |
| `both` | `idleMinutes` で入力禁止、さらに `archiveAfterMinutes`(既定 1440 = 24 時間)を超えたらアーカイブ |
| `off` | 何もしない(`/sentinel` と `/unlock` は使える) |

- 実効モード = state.json の `mode`(`/sentinel` で設定)があればそれ、なければ YAML の `mode`。
- 入力禁止のゲートは実効モードが `block` / `both` のときだけ働く(`agent/pre-step` のリスナーは常に登録し、呼ばれるたびにモードを見る)。
- アーカイブのサイクルは実効モードが `archive` / `both` のときだけ働く。
- `/unlock` は実効モードが `block` / `both` 以外なら「入力禁止は無効です(モード: X)」と返す。
- 表示する文面の言語は spec-ui.md §F に従う(ここに書く例は日本語)。

## B. `/sentinel` コマンド
| 入力 | 動作 |
|---|---|
| `/sentinel` | 状態表示: 実効モードとその出どころ(コマンド / YAML)、しきい値、このセッションの最終応答からの経過分、dryRun |
| `/sentinel block` / `archive` / `both` / `off` | 実効モードを変更し、state.json に保存(再起動後も維持)。変更後の状態を表示 |
| `/sentinel default` | state.json の `mode` を消し、YAML の値に戻す |
| それ以外 | エラー: 使い方を表示 |
- 出力の文面は表示言語(spec-ui.md §F)に従う(本書に書く例は日本語)。
- モード変更は即時に反映する(次のステップ・次のサイクルから)。
- `archive` / `both` に初めて変わったとき、state.json に `baselineAt` が無ければ現在時刻を記録する(過去のセッションを一斉にアーカイブしないため)。

## C. 永続状態 (state.json, version 2)
```json
{ "version": 2, "mode": "both", "baselineAt": 1792062384184, "unarchivedAt": { "<sessionId>": 1792064310709 } }
```
- `mode` と `baselineAt` は省略可。version 1(`mode` なし・`baselineAt` 必須)も読める。破損時は空の状態(mode なし・baselineAt なし)。
- 場所: `$DSH_HOME/cache-sentinel/state.json`(設定 `stateFile` で変更可)。

---

# 入力禁止(block)の詳細 — v0.3 から変更なし

## 1. 目的
プロンプトキャッシュが切れた(最後のモデル応答から一定時間が過ぎた)セッションで、
**トークンやコンテキストをモデル / API に送る行為をすべて止める**。セッションは開けて、閲覧もできる。
ユーザーが `/unlock` で明示したときだけ送信を通す。

## 2. 用語
- **最終応答時刻 (lastResponseAt)**: そのセッションの最後の `step/end` イベントの `time`(epoch ms)。
  フォークで引き継いだ部分も含めて探す(引き継いだ履歴もキャッシュなしで送られるため)。
  `step/end` が 1 つもなければ undefined(新規セッション)。
- **経過時間** = `now - lastResponseAt`。
- **失効**: 経過時間 > `idleMinutes` 分(既定 60)。

## 3. ゲート (agent/pre-step)
- `ctx.on('agent/pre-step', listener, { prepend: true })` で**最も外側**に登録する。
  自動圧縮(`dsh-compaction-basic`)も同じ waterfall の中でモデルを呼ぶため、それより先に判定する必要がある。
- 判定(`decideGate`、純粋関数):
  1. `lastResponseAt` が undefined → 通す(新規セッション)。
  2. 失効していない → 通す。
  3. 有効な解除許可(§4)がある → 通す(許可は消費しない。§4)。
  4. それ以外 → `{ kind: 'reject' }` を返す(`next()` を呼ばない)。
- 対象はメッセージの出どころを問わない: ユーザーの送信、リマインダー、ゴールの自動継続、ジョブ完了通知、
  サブエージェントの継続、ターン途中のステップ(長いツール実行の後)すべて。
- 拒否の効果(DSH の仕様、spike で確認): リクエストは発生しない。そのステップに入る予定だった入力メッセージは破棄され、
  ターンは `blocked` で終わる。履歴は変わらない。
- `dryRun: true` のときは拒否せず、「拒否するはずだった」ことをログに出して `next()` を呼ぶ。

## 4. 解除 (`/unlock` コマンド)
- `ctx.commands.register({ name: 'unlock', ... })` で登録する。モデルへのメッセージは作らない。
- 実行したセッションに解除許可 `grantedAt = now` を記録する(メモリのみ。再起動で消える)。
- 許可が有効な条件: `now - grantedAt <= unlockTtlMinutes`(既定 10)かつ `lastResponseAt < grantedAt`。
  - 許可後に 1 度でもモデル応答があれば(`lastResponseAt >= grantedAt`)許可は役目を終え、以後は通常判定に戻る。
    応答直後は失効していないので、そのままの会話は自然に続く。
  - 許可後 `unlockTtlMinutes` 以内に送信がなければ失効する(放置中に自動実行が許可を使うのを防ぐ)。
- 応答テキスト(GUI に表示される):
  - 失効中: 「次の送信を許可しました。最終応答から N 分経過しているため、キャッシュなしの料金になります(許可は M 分有効)」
  - 失効していない: 「最終応答から N 分です。キャッシュは有効なのでそのまま送信できます」(許可は記録しない)
  - 応答がまだない: 「このセッションはまだモデル応答がありません」(許可は記録しない)
  - 文面の言語は表示言語(spec-ui.md §F)に従う(ここに書く例は日本語)。
- ブロックされた文面は破棄されているので、ユーザーは解除後に入力し直す。

## 5. ログ
- `[cache-sentinel]` 付きで console と ctx.logger に出す(旧方式で確立)。
- 出すもの: 起動(設定値)、ブロック(セッション id・経過分・ステップ番号)、解除の付与、dryRun の判定。
- 同じセッションで連続してブロックしてもログは毎回出す(頻度は送信回数分のみ)。
- ログの文面は翻訳しない(日本語のまま。spec-ui.md §F)。

## 6. 設定 (config) — v0.4 で全モード分を統合
| キー | 型 | 既定 | 意味 |
|---|---|---|---|
| `mode` | `block`/`archive`/`both`/`off` | `block` | 既定モード(§A) |
| `idleMinutes` | 整数 ≥1 | 60 | 入力禁止のしきい値。`archive` モードではアーカイブのしきい値 |
| `archiveAfterMinutes` | 整数 ≥1 | 1440 | `both` モードのアーカイブのしきい値 |
| `unlockTtlMinutes` | 整数 ≥1 | 10 | `/unlock` の有効時間 |
| `checkIntervalSeconds` | 整数 ≥10 | 60 | アーカイブのチェック間隔 |
| `skipPinned` | boolean | true | ピン留めをアーカイブしない |
| `archiveExisting` | boolean | false | 基準時刻より前に止まったセッションもアーカイブ対象にする |
| `maxPerCycle` | 整数 ≥1 | 20 | 1 サイクルのアーカイブ上限 |
| `dryRun` | boolean | false | 拒否もアーカイブもせずログのみ |
| `stateFile` | string | `$DSH_HOME/cache-sentinel/state.json` | 永続状態 |
未知キー・型不正は例外(旧方式と同じ方針)。

## 7. 最終応答時刻の取得
- 初回はそのセッションのイベント(`session.snapshotEvents()`)を末尾から走査して `step/end` を探し、セッション id ごとにキャッシュする。
- 以後は `session/event` リスナーで `step/end` を受けたら更新する。
- 取得に失敗したら通す(安全側=作業を止めない)。ログに warn。

## 8. 非目標 / 既知の制限
- GUI でのバッジ表示・ブロック理由の表示(クライアントプラグインが必要)。ブロックが GUI でどう見えるかは T9 で確認する。
- タイトル自動生成(`session-title-first-prompt-llm`)は最初の送信時に独立してモデルを呼ぶ。新規セッションか
  古いセッションのフォークの初回だけで、送るのは最初のメッセージのみなので対象外とする。
- 自動レビュー(experimental)はゲートを通過したターンの中でしか動かないので対象外。
- サブエージェントのセッションでは GUI から `/unlock` を打てない。親の再開だけでは通らない(サブエージェント側で失効していれば止まる)。
- キャッシュの実際の寿命はプロバイダとリクエスト内容で決まる。本プラグインは時間だけで判定する近似。
- 対象は `dsh-web-app` バンドルを含むプロファイル(`web`・`desktop`)。`workspaceRegistry` と `connection` を必須で
  inject するので、headless などでは起動しない(#15、根拠は spike.md「対象プロファイルの調査」)。

## 9. 受入基準
- B1: 失効したセッションでの送信は拒否され、モデルへのリクエストが発生しない。
- B2: 失効していない・新規セッションは通る。境界(ちょうど idleMinutes)は通す。
- B3: `/unlock` 後の送信は通り、その応答後の会話も通る。
- B4: `/unlock` から `unlockTtlMinutes` を過ぎると許可は無効。
- B5: 許可後に応答があった後、再び失効したら再び拒否される(許可は再利用されない)。
- B6: ゲートは自動圧縮より先に評価される(`prepend`)。
- B7: `dryRun` では拒否しない。
- B8: 最終応答時刻の取得失敗時は通す。
- B9: 設定の検証(§6)。
- C1: `/sentinel archive` で入力禁止が止まりアーカイブが始まる。`/sentinel block` で逆。`off` で両方止まる。
- C2: `/sentinel` のモードは再起動後も維持され、`/sentinel default` で YAML に戻る。
- C3: `both` では 60 分で入力禁止、24 時間でアーカイブ。
- C4: 初めてアーカイブが有効になったとき、それ以前に止まっていたセッションはアーカイブされない(`archiveExisting: false`)。
