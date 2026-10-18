# cache-sentinel 仕様 v0.5 — UI 対応(公式 UI と m3e)

[spec.md](spec.md)(v0.4)に次の 3 つを足す。

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
- 拒否するたびに毎回通知する(破棄した文面を見せるため)。拒否するのはユーザーの送信を含むステップだけ
  (spec.md §3)なので、入力 0 件の拒否は起きない。v0.5 にあった入力 0 件の連続通知の抑制(10 分に 1 回)は
  spec.md v0.6(#7)で削除した。
- 追加に失敗しても拒否はそのまま行う(warn ログのみ)。
- 文面の言語は §F に従う(ここに書く例は日本語)。

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

### E2. 表示の規則(両 UI 共通、純粋関数 `bannerFor(status, now, locale)`)
| 条件 | 表示 |
|---|---|
| gate かつ state = stale かつ dryRun でない | 警告:「キャッシュ切れ(最終応答から {N} 分)。このまま送ると止められます。」+ ボタン「次の 1 回を許可(/unlock)」 |
| gate かつ state = unlocked | 情報:「次の送信を許可中(キャッシュなしの料金になります)。あと {M} 分」 |
| それ以外 | 何も出さない |
- 文面の言語は §F に従う(表に書く例は日本語)。
- 取得は表示中のセッションについて、表示開始時・30 秒ごと・画面が前面に戻ったとき・ボタン操作の後。失敗したら何も出さない(送信の邪魔をしない)。
- ボタンは `/unlock` コマンドを実行し、結果の文面は通常のコマンド結果として会話に出る。

### E3. 公式 UI(cache-sentinel のクライアント半分)
- `package.json` の `exports['./client']` = `lib/client.js`、`dsh.client = { platform: 'web', immediately: false, inject: ['@deepseek-ai/dsh-client-ui-conversation'] }`。
- `ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name, id: 'cache-sentinel', order: 5, inject: (sessionId) => ({ sessionId, locale, unlock }) }, Banner))`。
  `unlock` は `ctx.remote.commands.execute(sessionId, '/unlock', [])`。`locale` は `navigator.languages` から決める(§F)。
- 取得 URL は `new URL('api/cache-sentinel.status?sessionId=…', document.baseURI)`。
- ビルド: esbuild で CJS(browser)にし、`window.__ModuleLoader__.load({ id, factory })` で包む(dsh-webui-m3e と同じ)。React は外部(シェルが提供)。
  React の型のために依存を足さず、使う API だけの最小の型宣言を置く。

### E4. m3e(dsh-webui-m3e)
- m3e は他プラグインのクライアント半分を読み込まないため、m3e 本体に同じ表示を足す(別リポジトリ)。
- 取得 URL は `new URL('../api/cache-sentinel.status?…', location.origin + import.meta.env.BASE_URL)`。
  cache-sentinel が入っていない DSH では 404 になるので、そのときは何も出さない。
- 表示位置は入力欄の上(`Composer.tsx` の既存の `composer-notice` / `composer-error` と同じ並び)。ボタンは m3e のコマンド実行の経路で `/unlock` を送る。

## F. 表示の言語
- 対応する言語は `en` / `ja` / `zh-CN`。判定できない場合と未対応の言語は `en`。
- 判定は純粋関数 `resolveLocale(candidates)`(`src/i18n.ts`)で行う。
  - 候補を先頭から見て、空文字・`C`・`POSIX` は飛ばし、最初に見つかったもので決める。
  - `.` 以降(エンコーディング)と `@` 以降(修飾子)を落とし、`_` を `-` とみなす(`ja_JP.UTF-8` → `ja`)。
  - `ja` で始まる → `ja`、`zh` で始まる → `zh-CN`、`en` で始まる → `en`、それ以外 → `en`。
- Host 側の候補は `LC_ALL`、`LC_MESSAGES`、`LANG`、`Intl.DateTimeFormat().resolvedOptions().locale` の順。`apply` で 1 回決める(環境の読み取りは `src/index.ts` が行い、純粋関数には候補だけを渡す)。
- クライアント側の候補は `navigator.languages`(無ければ `navigator.language`)。`src/client/index.ts` が読み取り、`bannerFor` / `unlockLabel` に渡す。DSH には言語を持つ `ctx.locale`(`dsh-client-locale`)もあるが、クライアントの inject を増やさないため今回は使わない。
- 会話に書き込むブロック通知は、書き込んだ時点の Host の言語で書く(後から言語が変わっても、その行は書き直さない)。
- 翻訳の対象は、ブロック通知(`src/notice.ts`)、バナーとボタン(`src/client/banner.ts`)、`/sentinel`・`/unlock` の出力(`src/mode.ts`・`src/unlock.ts`)、設定エラー(`src/config.ts`)、コマンドの説明(`src/index.ts`)。
- ログ出力(`[cache-sentinel]` の行)は翻訳しない(日本語のまま)。
- 文言は言語ごとのカタログ `src/messages.ts` にまとめ、3 言語が同じキーと同じ引数を持つことを型(`Record<Locale, Messages>`)で保証する。

## 受入基準
- D1: ブロックすると、そのセッションの会話に「送信を止めました…」の行が出る(公式・m3e)。破棄された文面が含まれる。
- D2: 保存されたセッションを再読み込みしても壊れない(合成した command イベントが検証を通る)。
- D3: (削除。spec.md v0.6 で入力 0 件の拒否が無くなったため)
- E1: status が仕様どおりの JSON を返す。未認証は拒否される。sessionId なしは 400。
- E2: 公式 UI で、失効したセッションを開くと入力欄の上に警告とボタンが出る。ボタンで許可され、表示が「許可中」に変わる。
- E3: m3e で同じ表示が出る。cache-sentinel が無い DSH では何も出ない。
- F1: 通知・バナー・コマンド出力・設定エラーが 3 言語それぞれでその言語になり、未対応の言語では英語になる。
