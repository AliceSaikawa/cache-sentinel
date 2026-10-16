# cache-sentinel 仕様 v0.5 — UI 対応(公式 UI と m3e)

[spec.md](spec.md)(v0.4)に次の 2 つを足す。

## D. ブロックしたことを会話に表示する(Host のみ、両 UI 共通)
- 入力禁止でステップを拒否したとき(dryRun ではないとき)、そのセッションに次のペアを `session.append` で追加する。
  - `command/run` `{ commandId, name: 'cache-sentinel', args: '', source: { kind: 'user' } }`
  - `command/done` `{ commandId, kind: 'error', text }`
- 理由: 両 UI とも `command/run`/`command/done` をコマンド結果の行として描画する(公式: `dsh-client-ui-chat` の command Definition、
  m3e: `web/src/features/chat/model.ts`)。保存形式の検証は「commandId が重複しない」「done の前に run がある」だけ
  (`dsh-session-format-v3-to-v4` の検査)なので、合成しても読み込めなくならない。独自のイベント種別は保存時に拒否されるため使わない。
  コマンドのイベントはモデルに送られない(log-only)。`source.kind` は既存の 'user' しかないので 'user' を使う(既知の妥協)。
- `commandId` = `cache-sentinel-<sessionId>-<time>-<連番>`(プロセス内で一意)。
- `text`(`buildBlockNotice`、純粋関数):
  ```
  送信を止めました(最終応答から {N} 分。キャッシュが切れている可能性が高いため)。
  /unlock で次の 1 回を許可できます。
  破棄された入力:
  {入力1のテキスト}
  ```
  - 入力は、拒否したステップに入る予定だった `messages` の `content` のうち `type: 'text'` の `text` を連結したもの。
    1 件あたり 2000 文字まで(超えたら末尾に「…(以下省略)」)。テキストがなければ「破棄された入力」の節を出さない。
  - 画像などテキスト以外が含まれていたら「(画像などテキスト以外の添付 {k} 件も破棄されました)」を足す。
- 連続通知の抑制: 入力メッセージが 0 件のステップ(ターン途中や自動の継続)を拒否したときは、同じセッションで直近 10 分以内に通知していれば追加しない。
  入力メッセージがあれば毎回通知する(破棄した文面を見せるため)。
- 追加に失敗しても拒否はそのまま行う(warn ログのみ)。

## E. 送信前に「入力禁止中」を表示する
### E1. 状態の取得口(Host)
- `ctx.connection.fetch.register({ path: '/api/cache-sentinel.status', methods: ['GET'], requestBody: 'buffered', fetch })`
  (`dsh-session-log-export` と同じ方式。認証は Connection の `/api` と同じ)。
- `GET /api/cache-sentinel.status?sessionId=<id>` → `200 application/json`, `cache-control: no-store`:
  ```json
  { "mode": "block", "gate": true, "state": "stale", "idleMinutes": 75, "thresholdMinutes": 60,
    "unlockExpiresAt": null, "dryRun": false }
  ```
  - `gate`: 実効モードが入力禁止を含むか(block / both)。
  - `state`: `'inactive'`(gate が偽)/ `'unknown'`(セッションが読み込まれていない)/ `'no-response'` / `'fresh'` / `'stale'` / `'unlocked'`(stale だが有効な /unlock がある)。
  - `idleMinutes`: 最終応答からの経過分(切り捨て)。応答がない・unknown なら null。
  - `unlockExpiresAt`: unlocked のとき許可の期限(epoch ms)。それ以外 null。
  - sessionId がない・空なら 400。
- 判定は純粋関数 `computeStatus` に置く(block.ts の判定と同じ部品を使う)。

### E2. 表示の規則(両 UI 共通、純粋関数 `bannerFor(status, now)`)
| 条件 | 表示 |
|---|---|
| gate かつ state = stale かつ dryRun でない | 警告:「キャッシュ切れ(最終応答から {N} 分)。このまま送ると止められます。」+ ボタン「次の 1 回を許可(/unlock)」 |
| gate かつ state = unlocked | 情報:「次の送信を許可中(キャッシュなしの料金になります)。あと {M} 分」 |
| それ以外 | 何も出さない |
- 取得は表示中のセッションについて、表示開始時・30 秒ごと・画面が前面に戻ったとき・ボタン操作の後。失敗したら何も出さない(送信の邪魔をしない)。
- ボタンは `/unlock` コマンドを実行し、結果の文面は通常のコマンド結果として会話に出る。

### E3. 公式 UI(cache-sentinel のクライアント半分)
- `package.json` の `exports['./client']` = `lib/client.js`、`dsh.client = { platform: 'web', immediately: false, inject: ['@deepseek-ai/dsh-client-ui-conversation'] }`。
- `ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name, id: 'cache-sentinel', order: 5, inject: (sessionId) => ({ sessionId, unlock }) }, Banner))`。
  `unlock` は `ctx.remote.commands.execute(sessionId, '/unlock', [])`。
- 取得 URL は `new URL('api/cache-sentinel.status?sessionId=…', document.baseURI)`。
- ビルド: esbuild で CJS(browser)にし、`window.__ModuleLoader__.load({ id, factory })` で包む(dsh-webui-m3e と同じ)。React は外部(シェルが提供)。
  React の型のために依存を足さず、使う API だけの最小の型宣言を置く。

### E4. m3e(dsh-webui-m3e)
- m3e は他プラグインのクライアント半分を読み込まないため、m3e 本体に同じ表示を足す(別リポジトリ)。
- 取得 URL は `new URL('../api/cache-sentinel.status?…', location.origin + import.meta.env.BASE_URL)`。
  cache-sentinel が入っていない DSH では 404 になるので、そのときは何も出さない。
- 表示位置は入力欄の上(`Composer.tsx` の既存の `composer-notice` / `composer-error` と同じ並び)。ボタンは m3e のコマンド実行の経路で `/unlock` を送る。

## 受入基準
- D1: ブロックすると、そのセッションの会話に「送信を止めました…」の行が出る(公式・m3e)。破棄された文面が含まれる。
- D2: 保存されたセッションを再読み込みしても壊れない(合成した command イベントが検証を通る)。
- D3: 入力 0 件の連続拒否で通知が 10 分に 1 回までになる。
- E1: status が仕様どおりの JSON を返す。未認証は拒否される。sessionId なしは 400。
- E2: 公式 UI で、失効したセッションを開くと入力欄の上に警告とボタンが出る。ボタンで許可され、表示が「許可中」に変わる。
- E3: m3e で同じ表示が出る。cache-sentinel が無い DSH では何も出ない。
