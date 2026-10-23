# rdsh 環境での動作確認 (Issue #16, 2026-10-17)

> この文書は開発時の記録です。

rustdsh(main `fc63bf2`)と一緒に cache-sentinel が入る環境で、Issue #16 の確認項目を調べた記録。
日付は 2026-10-17〜10-18(JST)。

## 確認の方法

結果ごとに次の 3 区分で書き分ける。

- **実機(web プロファイル)**: DSH 0.2.0-rc.2 の web プロファイルを、検証用に隔離した `HOME`/`DSH_HOME` のもとで起動し、headless chromium(127.0.0.1:5291)で操作した結果。有効化したプラグインは cache-sentinel(モード `block`, `idleMinutes: 1`)+ rdsh-mobile-ui + rdsh-ui-comfort + rdsh-answer-guard の 4 つ。
- **コード確認のみ**: rustdsh の shallow clone(main `fc63bf2`)のプラグインソース、cache-sentinel のソース、DSH 本体(0.2.0-rc.2)の型定義と lib 実装を読んで突き合わせた結果。動作は保証しない(バナーの `/unlock` ボタンのように、コード読みでは「動く見込み」と判断した経路が実機で動かなかった例がある)。
- **未確認**: 今回の方法では確かめられなかったもの。最後の節に、何があれば確認できるかの手順を置いた。

制約:

- このマシンには cargo・`rdsh`・Desktop アプリがなく、`dsh` CLI は `desktop` プロファイルの起動と管理を拒否する。Linux は Desktop のビルド/配布対象外。Desktop(Electron)に関しては環境の確認(コマンドの有無・同梱 DSH 版の特定)のみ行った。
- LLM の API キーは使っていない(利用者の資格情報をコピーしない方針)。アシスタント応答が一度も発生せず、応答を起点にする挙動(answer-guard のリマインダー等)は実機で再現できなかった。
- スクリーンショット・生ログは成果物には含めない(コミット対象外のため)。

引用の形式: rustdsh は `rustdsh/<パス>:行@fc63bf2`。DSH 本体 0.2.0-rc.2 は `@deepseek-ai/<パッケージ>/<ファイル>:行`(DSH インストール先 `node_modules/@deepseek-ai` 配下)。

## Issue の確認項目ごとの結果

| Issue 本文の項目 | 結果 | 確認方法 |
|---|---|---|
| Desktop の同梱 DSH 版(#12 の対応範囲) | 対応範囲内(0.2.1-alpha.2)。動作は未確認 | コード確認のみ |
| Desktop のバナー表示と状態取得 API | 未確認(仕組み上は通る見込み) | コード確認のみ (+ 未確認) |
| Desktop のブロック通知と `/unlock` | 未確認(コード上は Host 側で完結) | コード確認のみ (+ 未確認) |
| rdsh-mobile-ui のバナー表示 | 干渉なし | コード確認のみ + 実機(web プロファイル) |
| rdsh-ui-comfort の `/unlock` とブロック | コマンド経路(手打ち・slash menu)は動く。バナーのボタンは不具合 | 実機(web プロファイル) + コード確認のみ |
| rdsh-answer-guard と入力禁止 | 未確認(コード上は干渉の経路あり = Issue #7 と同型) | コード確認のみ (+ 未確認) |

### 1. Desktop の同梱 DSH 版(#12 の対応範囲に入るか)

Desktop に同梱される DSH は **0.2.1-alpha.2**(固定 revision `d743267…`)。**コード確認のみ**(実機で動かしていない)。

- 根拠: `rustdsh/desktop/upstream.lock.json:5-6@fc63bf2`(harnessVersion / sdkVersion)、`rustdsh/desktop/sdk/package.json:11@fc63bf2`、`rustdsh/desktop/sdk/package-lock.json:524,593@fc63bf2`(dsh-base / dsh-web-app)。
- README の対応範囲(0.2.0-rc.2〜0.2.1-rc.1、alpha.1〜alpha.5 を含む: `README.ja.md:194`)に**入る**。ただしこの範囲は 0.2.0-rc.2 との型・実装 diff(`docs/spike.md:110-139`)に基づく文書上の判断で、alpha.2 で動かした実績はない(alpha.2 は中間の状態: `docs/spike.md:120-122`)。
- 参考: rustdsh 自身が監査対象とする DSH 版(rc.2 / alpha.1 / alpha.3)には **alpha.2 は含まれない**(`rustdsh/src/tool_security.rs:22-39@fc63bf2`)。rustdsh 側の論点だが、Desktop 実機検証時には「どの DSH 版で見たか」を明記する。
- 見つかった課題: 対応範囲が README と `docs/spike.md` の記載だけで、worktree の `package.json` には `peerDependencies`/`engines` が無い。→ 後述の「対応 DSH 版を package.json で宣言していない」。

### 2. Desktop のバナー表示と状態取得 API(`/api/cache-sentinel.status`)

Desktop プロファイルでの実機確認は**未確認**(上記のとおり環境が無い)。コード確認のみの内容:

- 状態 API のルートは Host の `connection` に登録する(`src/index.ts:45,255-260`)。`workspaceRegistry` と `connection` は `dsh-web-app` バンドルが提供する(`@deepseek-ai/dsh-web-app/cordis.patch.yml:91-92,216-217`)。desktop プロファイルが `dsh-web-app` を含むなら inject は揃う見込み(傍証: 同ファイル `:45-47,57-59` の desktop 専用ガード)。
- クライアントは表示中ページの `document.baseURI` 相対で取得する(`src/client/index.ts:95`、`src/client/banner.ts:122`、`src/client/fetch-status.ts:11`)。Electron が Web アプリを HTTP(127.0.0.1)で読むなら届く。取得失敗時は何も出さない(`src/client/fetch-status.ts:14-16`、`docs/spec-ui.md:52`)ので、失敗はバナー無表示で終わる。
- 未確認: (a) desktop プロファイルの実 manifest(プロファイルは Electron アプリが初期化する。npm 版 DSH のテンプレートは acp/web/headless/sdk/sdk-minimal のみで desktop は無い)。(b) UI を読むオリジン(独自スキーム/file の場合は `baseURI` 相対の fetch が届かず無表示)。(c) Electron レンダラが exact route の信頼判定(owner 以外の接続元に 403: `README.ja.md:196`、`docs/spike.md:131`)を通るか。desktop 同梱 DSH は alpha.2。
- web プロファイルの実機では同種の API は問題なく動いた(下記 §4〜§6。ただし web そのものであり、Desktop の代替にはならない)。

### 3. Desktop のブロック通知と `/unlock`

Desktop プロファイルでの実機確認は**未確認**。コード確認のみの内容:

- どちらも Host 側で完結し、desktop プロファイル固有の処理は無い。
  - ブロック通知は `session.append('command/run')` + `('command/done')` を書くだけ(`src/block.ts:86-87`)。描画は公式 `dsh-client-ui-chat` のコマンド行。OS の `Notification` API は cache-sentinel は使わない(`src/` 全体に無し)。
  - `/unlock` は `ctx.commands.register` で登録する(`src/index.ts:244-248`)。実行はコマンド経路で、モデルステップを経ない(`docs/spike.md:99-102`)。
- 補足(実機、web プロファイル): 通知行の生成と `/unlock` の実行そのものは web プロファイル(0.2.0-rc.2 + 同梱 3 プラグイン)で動いた(§5)。ただしバナーの「次の 1 回を許可(/unlock)」ボタンは、プロファイルに依存しないクライアント側の不具合で**動かない**(後述)。Desktop でも同様に現れると見られる(クライアント共通のコードのため。実機では未確認)。
- 未確認: Desktop の preload・通知まわりの実装(`rustdsh/desktop/` には上流 Electron ソースが無く、ビルド差分だけのため rustdsh 側からは見えない。cache-sentinel は該当 API に依存しない)。

### 4. rdsh-mobile-ui × バナーの表示

**干渉なし**(コード確認のみ + 実機で表示確認)。

- コード確認のみ: mobile-ui は `<style>` の追加と属性の付け替えだけで、コンポーザ本体の DOM 構造は変更しない(`rustdsh/plugins/rdsh-mobile-ui/client.js:69-94@fc63bf2`)。触るのは CSS-module ハッシュクラスのグリッド列・サイドバー・幅変数(`client.js:25-67`)で、バナーの置かれる `conversation.input.dock` slot の要素・セレクタとは一致しない。バナーは `conversation.input.dock`(id `cache-sentinel`、order 5)の通常フロー要素(position / z-index 無し: `src/client/index.ts:46-88`)で、公式 UI では composerStack の中、入力バーの直前に描画される(`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:16309`)。rustdsh のプラグイン全体でもこの slot を触るものは 0 件(grep で確認)。
- 実機(web プロファイル、mobile-ui 有効): 1380x900 / 390x844 / 320x700 の 3 幅で、`data-testid="cache-sentinel-banner"` は各 1 個だけ(二重表示なし)。「キャッシュ切れ(最終応答から N 分)…」+ ボタンが表示され、composer の上に押し下げる形で出る(重なり・クリップ無し)。`/unlock` 後は 30 秒ポーリングでボタンが消え、情報トーン「次の送信を許可中…」に変わる。
- 未確認: ソフトキーボードを出したときの押しつぶし・ボタンのタップ可否(ヘッドレスのため)。狭い幅でバナー 1 行の高さが増える点は仕様どおり(入力欄の上)だが、実機の見え方は見ていない。
- 参考(mobile-ui 自体の性質で cache-sentinel には無関係): mobile-ui のルールは CSS-module ハッシュに張っており、DSH の版でクラス名が変わると効かなくなる(fail-closed)。バナー側は data 属性と素の style なのでこの影響を受けない。

### 5. rdsh-ui-comfort × `/unlock` とブロック

**ブロックのすり抜けも `/unlock` が送れなくなることもない**(実機 + コード確認のみ)。ただしバナーのボタンだけは不具合(後述)。

- コード確認のみ:
  - ブロックはサーバー側 `agent/pre-step` だけで行う(`src/index.ts:242`、`src/block.ts:103-137`)。クライアントは keydown を一切見ない(`src/client/index.ts:105` の visibilitychange のみ)。
  - ui-comfort は `window` capture の keydown で Enter を加工するが、2 回目の Enter(=送信)は手を出さずシェル自身のパスに任せる(`rustdsh/plugins/rdsh-ui-comfort/client.js:153-190@fc63bf2`)。README も "never calls the send path itself"(`rustdsh/plugins/rdsh-ui-comfort/README.md:95-96@fc63bf2`)。slash menu が開いているあいだの Enter は unhook(`client.js:67,177` で判定)。→ `/unlock` の選択操作は ui-comfort の割込みの外。
  - 手打ち `/unlock` + Enter 2 回(draft が `/unlock\n`)もコマンドとしてパースされる: `/` 始まりの draft は plain 扱いしない(`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:17406`)、`parseCommand` の lookahead が直後の改行を許す(`@deepseek-ai/dsh-commands/lib/index.js:102-112`)。
- 実機(web プロファイル、ui-comfort 有効):
  - 失効中の送信はブロックされ、モデルへのリクエストは出ない。`turn/end` は `blocked`、`step/start` は書かれない。拒否した入力本文は通知の「破棄された入力:」の節に入る(連続で 2 回再現)。
  - `/unlock`: (a) composer に `/unlock` を入れて slash menu から Enter 1 回 → 実行される。(b) menu を閉じて Enter 2 回(1 回目は改行のみ、2 回目で送信)→ 実行される。実行後は状態 API が `state: "unlocked"` になり、許可は 1 回で消費される(許可後の 1 送信は通り、以後は失効に戻る)。
  - バナーの「次の 1 回を許可(/unlock)」ボタン→ **何も起きない**(不具合。後述)。
- 切り分け未了の観察(実機): (b) の 1 回目の Enter で composer の値が `abc` → `abc\n\n` になった。**この事象は切り分け未了**(#28)で、確定した不具合としては扱わない。分かっている範囲: CDP の合成キーイベントによるものか、ui-comfort のフォールバック経路(replay)が二重に効いているのかは不明(ui-comfort 側の該当箇所は `client.js:126-133,153-190@fc63bf2`)。ui-comfort を無効化すると 1 回目の Enter で即送信される(stock の挙動)ことは確認済みで、有効時に限って改行が入る。Enter の観察はこの 1 回のみで、改行が 2 個入る条件(送信ごとか、初回だけか)も未確認。再現条件の特定には新たな実機確認が要る。
- 未確認: 誤操作時の見え方(バナーが出ている状態で Enter 1 回だけ押して送信されない様子)のスクリーンショット・スマホ実機での確認。

### 6. rdsh-answer-guard × 入力禁止

実機では **未確認**(下記の理由)。コード確認では干渉の経路が存在し、**Issue #7 と同型**と書いてよい:

- コード確認のみ:
  - リマインダーは composer 打鍵ではなく、`agent/turn-stopping` で `agent.steer(reminder)` を呼ぶ形(`rustdsh/plugins/rdsh-answer-guard/index.js:170-185@fc63bf2`)。steer された入力は次のステップとして `agent/pre-step` を経る(`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:194-200`、agent-loop の claim → waterfall 実装 `@deepseek-ai/dsh-agent-loop/lib/index.js:902-924,958-961`)。
  - したがって入力禁止(失効)中は**リマインダーのステップも cache-sentinel の判定で拒否され破棄される**。これは「ユーザーの送信以外も止める」仕様(§3、Issue #7)の 1 事例。
  - ただし実際の衝突は起きにくい: guard が nudge するのは「ターン最後の assistant message が reasoning-only(ツール呼び出しを含まない)」の直後(`rustdsh/plugins/rdsh-answer-guard/index.js:106-126@fc63bf2`)であり、既定 60 分の idleMinutes の失効と重なる構図はほぼ無い(検証用の短い idleMinutes では起こりうる)。nudge はターン内 1 回のみで、ループにはならない。
  - リマインダーが拒否されたとき利用者に見える通知は、破棄入力本文の連結(`src/block.ts:135` → `src/notice.ts:55-80`)で、この場合は**モデル向けの英語文(REMINDER_TEXT)が全文**出る(後述の不具合)。guard 側は committed `assistant/message` しか見ないため、ブロック通知の `command/run`/`command/done` で誤動作しない(`:160-168` の早期 return)。
  - 破棄のとき guard 側の救済(nudge)は消費済みになる(steer 呼び出しの直前にカウント: `:178-184`)。ブロックされたターンは無回答のまま閉じる。cache-sentinel 側の仕様(止める対象を絞る)で自然に解消する。
- 未確認の理由(実機): guard の nudge 前提は committed `assistant/message`(= LLM 応答)。API キーが無く応答が一度も発生しないため、answer-guard のプラグインが有効になっていること(確認済み)以外の干渉挙動は実機で 1 事例も作れなかった。「reject された steered 入力が受信箱に parked で残るか」も未確認(根拠は `agent.steer` の型コメントのみ。dsh-agent-loop の inbox/claim 実装の追跡まで行っていない)。

## 見つかった不具合・懸念

### 新規(Issue 化済み)

既存 Issue との重複を確認したうえで新しく起票した課題。

1. **バナーの `/unlock` ボタンが動かない(#26)**(実機 + コード確認)。失効中(警告トーン)にボタンを押すと `cannot get property "remote.commands" without inject` の例外で失敗する(状態 API も会話も無変化)。原因: クライアント半分の `inject` が `['slots','remote']` で `remote.commands` が無い(`src/client/index.ts:12`)。押下時には例外が通知されず静かに失敗するため(ボタンは警告トーンでのみ描かれる)、利用者には原因が見えない。DSH のクライアントでは `remote.commands` は独立したサービスキーで、公式プラグインは必ず併記する(`@deepseek-ai/dsh-client-ui-plan/lib/client.js:605-614`、`@deepseek-ai/dsh-client-ui-commands/lib/client.js:752-757`)。情報トーンではボタンを描かないためこの形でしか現れない。受入基準 E2 のボタン経路を満たせない。あわせて `remote.commands.execute` の戻り値の union(`{ok: false, error}`)を捨てない(`src/client/index.ts:55`。公式は `ok` を見る: `@deepseek-ai/dsh-client-ui-commands/lib/client.js:1068-1069`)。
2. **ブロック通知が折りたたみの奥に隠れる(#27)**(実機)。通知の `command/run`+`command/done` はブロックされた turn の内側(`turn/start` と `turn/end` の間)に書かれ、公式 UI はその turn を process group として折りたたむ。送信直後に見えるのは turn の完了表示だけで、通知本文は 2 段(「Completed …」を開いてから内側の項目を開く)先でしか読めない。正常な `/unlock` の行は turn の外に書かれるため最初から見える。spec-ui §D は「コマンド結果の行として描画すること」のみを要求しており仕様違反ではないが、受入基準 D1 を「利用者が気づける」と読むなら見直しの価値がある(通知を turn 外に置く等。仕様判断が必要)。
3. **ui-comfort 併用時に 1 回目の Enter が送信にならず誤認しやすい(#28)**(実機)。失効中でも Enter 1 回は改行が入るだけなので、利用者が「ブロックされた」と誤認する余地がある。2 回押せば送信されサーバー側でブロックされるので自然に判明するが、バナーの文言は「このまま送ると止められます」のみ。関連する切り分け未了の観察: 1 回目の Enter で改行が 2 個入った(§5)。クライアント側で Enter を止める方式は ui-comfort の capture/replay と将来競合するため採用しない。→ 対応済み(#28): バナーの文言は変えず、README(3 言語)の「UI での表示」に併用時の見え方を書き、spec-ui §E2 にバナーが打鍵方式に依存する案内を持たないことを明記した。改行 2 個の事象は §5 のとおり切り分け未了のまま記録する。
4. **拒否通知にモデル向けの英語文が全文出る(#29)**(コード確認のみ)。プラグイン由来の入力(answer-guard のリマインダー、`source.form: 'notice'`)が破棄されると、モデル向けの英語の指示文(REMINDER_TEXT)がそのまま「破棄された入力」の節に出る(`src/block.ts:135` → `src/notice.ts:55-80`、1 件 2000 字までで切る)。source の判別ができれば summary の短文に差し替えるか省略表示できる(#7 の「判定データの調整」と共通する部分がある)。
5. **同一文面の通知が積み重なる(#30)**(コード確認のみ)。入力メッセージがある拒否は毎回通知する仕様(`src/notice.ts:104-111`)のため、連打や誤送信の反復で同一文面のブロック通知が複数行積み上がる(spec §D の変更で、同一テキストの連続通知は N 分に 1 件に抑える案)。
6. **対応 DSH 版を package.json で宣言していない(#31)**(コード確認のみ)。対応範囲(0.2.0-rc.2〜0.2.1-rc.1、alpha 含む)が README と spike の記載だけ(`README.ja.md:194`、`docs/spike.md:110-139`)で、`peerDependencies`/`engines` が無い。DSH には宣言された peer range を起動時に強制する仕組みがあるため、宣言ができれば機械的に防げる。#12(README 上の範囲明記)とは補完の関係で両立できる。ただし DSH の host plugin として `peerDependencies` がどう評価されるかの確認が先。

### 既存 Issue と重複するもの

| 見つかった点 | 既存 Issue |
|---|---|
| web と desktop で `$DSH_HOME` を共有すると `state.json` が競合する | #9 |
| `github:` 指定でそのまま入れると `lib/` が無く動かない(推奨環境での導入導線) | #14 |
| desktop プロファイルの導入手順・「Desktop でバナーが出ないとき」のトラブルシューティング | #15 |
| `agent/pre-step` の判定が入力の出どころ(source)を見ず、answer-guard のリマインダーも止める | #7 |

### Issue 化せず未確認のまま残すもの

- `agent.steer` で reject された入力が受信箱に parked で残るか: 型コメント(`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:196-197`)は「残る」と読めるが、inbox/claim 実装の追跡まで行っていない。もし残るなら、`/unlock` 後の次の wake でリマインダー分のステップが走り、spec §4「次の送信を 1 回許可」と部分衝突する。answer-guard の確認手順の観察項目に入れる。

## 未確認として残る項目と実機確認の手順

### Desktop の実機確認(macOS / Windows x64 必須)

Linux は Desktop のビルド/配布対象外で、cargo / `rdsh` / Desktop アプリの無い環境では確認できない。Desktop アプリを一度起動したことがある環境で:

1. 導入: #14 の対応(リポジトリの `lib/` コミット)が取り込まれた版を使い、`rdsh desktop status` → `rdsh desktop install --no-bundled --package <spec>`(`github:` 指定が可能になっていればそれ、release tgz なら `file:` 指定)か、アプリの Plugins ページで追加。
2. 再起動して profile を再構成。`rdsh desktop verify --require cache-sentinel`。
3. ログ: `[cache-sentinel] 開始 …` が出る(出なければ inject 未解決 = `dsh-web-app` バンドル欠落)。
4. 状態 API: アプリ内のセッションで DevTools から `fetch('api/cache-sentinel.status?sessionId=<id>', { credentials: 'same-origin' })` が 200 を返すか(403 ならオリジンか信頼判定の問題)。
5. バナー: `idleMinutes` を小さくして失効させ、入力欄の上に警告とボタンが出るか(ボタンの不具合は修正版との同時確認にする)。
6. ブロック通知: 失効セッションへ送信して会話に通知が出るか、`/unlock` で 1 回通るか。
7. 共有状態: web と desktop を同時に使ったとき `$DSH_HOME/cache-sentinel/state.json` が競合しないか(#9)。
8. あわせて: desktop プロファイルの実 `package.json`(`bundles` に `@deepseek-ai/dsh-web-app` の有無)、UI を読むオリジン、レンダラの exact route 信頼判定と同梱 DSH の版(0.2.1-alpha.2)の明記。

### answer-guard の干渉(LLM 応答が必要)

1. reasoning-only 応答を出せる LLM(API キー)を、隔離した資格情報として用意する。
2. `mode: block` / `idleMinutes` を短くし、reasoning-only 応答の直後にリマインダーのステップが走るタイミングで失効させる。
3. ログで `[cache-sentinel] ブロックしました: … turn N step M` が出て、リマインダー分の `step/start` が出ないこと。turn が blocked で終わり、guard の救済(nudge)が消費されること(journal で確認)。
4. その後 `/unlock` → 通常の送信を行い、リマインダー分のステップが別途走らないか(parked steering の残留。流れてきたら残留の証拠)を確認。

### その他の未確認

- スマホ実機でのソフトキーボード干渉(バナーの押しつぶし・タップ可否)。
- サードパーティ推奨 3 件(dsh-sound-notifications / dsh-gitview / dsh-intelligent-ui): rustdsh リポジトリにソースが無く未確認。intelligent-ui はチャット幅・composer に影響する可能性、sound はブロックされたターンでも「応答完了」通知が鳴るか(README とソースの取得を要する)。
- M3E(spec-ui §E4)側の送信前表示: 対象リポジトリが本リポジトリと別のため未確認。
- Desktop 同梱 DSH(0.2.1-alpha.2)での動作一式(§1〜§3)。
