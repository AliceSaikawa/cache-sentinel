# 対応範囲の両端での実機確認 (Issue #12, 2026-10-18)

> この文書は開発時の記録です。

README の対応範囲(DSH 0.2.0-rc.2〜0.2.1-rc.1)の両端の版で、cache-sentinel の主な機能を同じ手順で動かした記録。
対応範囲はその後 #31 で 0.2.1-rc.2 まで広げた(rc.2 は型と実装の比較のみ。[spike.md](spike.md) の「rc.2 の追加調査」)。
途中の版(0.2.1-alpha.1〜alpha.5)は実機で動かしていない。型定義と実装の比較の結果は [spike.md](spike.md) の
「DSH 0.2.1 系との互換調査」にある。

## 結論

0.2.0-rc.2 と 0.2.1-rc.1 で、下表の項目はすべて同じ結果になった。版による違いは見つからなかった。
どちらの版でも、既知の不具合(#26・#27)と、今回見つかった `/sentinel <引数>` の不具合([#36](https://github.com/AliceSaikawa/cache-sentinel/issues/36)、後述)が同じように出た。
確認に使った cache-sentinel は main の `86a77f6` で、#26 の修正([#34](https://github.com/AliceSaikawa/cache-sentinel/pull/34)、main の `dd07050`)より前のビルド。

| 項目 | 0.2.0-rc.2 | 0.2.1-rc.1 |
|---|---|---|
| 入力禁止: 失効後の送信を拒否し、モデルへのリクエストを出さない(B1) | 動作 | 動作 |
| 入力禁止: 許可後の応答のあと再び失効すると、また拒否する(B5) | 動作 | 動作 |
| `/unlock`: 入力欄から実行すると次の送信が通り、応答直後の送信も通る(B3) | 動作 | 動作 |
| `/sentinel`: 引数なしの状態表示(入力欄から) | 動作 | 動作 |
| `/sentinel block`・`archive`・`both`・`off`・`default`・不正な引数(RPC から) | 動作 | 動作 |
| archive のサイクル: 基準時刻後に動いたセッションをアーカイブ、手動解除の検出、猶予後の再アーカイブ(A1・A5・C1) | 動作 | 動作 |
| ブロック通知: `command/run` と `command/done` を書き、破棄した入力を含める(D1) | 動作(表示は #27 のとおり折りたたみの中) | 同左 |
| 入力欄の上のバナー: 失効中は警告とボタン、`/unlock` 後は「許可中」(E2 の表示) | 動作 | 動作 |
| バナーのボタン「次の 1 回を許可(/unlock)」 | 動かない(#26。確認に使った `86a77f6` では動かない。[#34](https://github.com/AliceSaikawa/cache-sentinel/pull/34) で修正済みで、修正後は 0.2.0-rc.2 の実機で確認) | 動かない(同左。修正後のボタンは未確認) |
| 状態取得 API(E1): 認証なし 401、`sessionId` なし 400、Cookie 付きは 200(Cookie の種類は下の「0.2.1-rc.1 の 403 について」) | 動作 | 動作 |

## 環境

- DSH は npm の配布物をそのまま使った。`npm install --prefix <作業ディレクトリ>/<版>/prefix @deepseek-ai/dsh@<版>` で
  版ごとに別の場所へ入れた(npm 12 の既定どおり、依存のインストールスクリプトは実行されない。このマシンでふだん使っている DSH も同じ状態)。
  `dsh --version` はそれぞれ `0.2.0-rc.2` と `0.2.1-rc.1`。
- `HOME`・`DSH_HOME`・`XDG_*`・`TMPDIR` を版ごとの作業ディレクトリに向けて隔離した。利用者の `~/.dsh` と
  動いている GUI には触れていない。
- プロファイル: `web`(テンプレートの既定)。`dsh plugin --profile web add file:<tgz>` で cache-sentinel を追加した。
  tgz は main(`86a77f6`)で `pnpm pack` したもので、中の `lib/index.js`・`lib/client.js` はコミット済みの `lib/` と一致する。
  sha256 は `c47241cd4f54607b84d7019b8b3bbc1c96320140f320c9a1a43d6f50401795c7`。
- `cordis.patch.yml` に `mode: block`、`idleMinutes: 1`、`checkIntervalSeconds: 10` を入れた。
- LLM: 実在の資格情報は使っていない。Messages 互換のモックサーバーを 127.0.0.1 に立て、`DEEPSEEK_BASE_URL` をそこへ向け、
  `DEEPSEEK_API_KEY` にはダミーの文字列を入れた(`dsh-llm-deepseek` の README「Endpoint and wire format」)。
  モックは受けたリクエストを 1 行ずつ記録して固定文を返すので、リクエストが出たかどうかをモック側の記録で確かめられる。
- 操作: headless chromium(Playwright 同梱のバイナリ)を CDP で操作した。UI の言語は英語(DSH は `zh`/`en` のみ)、
  ブラウザの言語は `ja-JP` なので、cache-sentinel の文言は日本語で出る。
- 観察: サーバーログ(`[cache-sentinel]` の行)、セッションログ(`session.v4.jsonl.zstd` を展開したイベント列)、
  モックの記録、DOM(バナーの数・文言・位置)、スクリーンショット。スクリーンショットと生ログはコミットしない。

## 手順と結果

両方の版で同じ順に操作した。時刻は省き、結果だけ書く。版で違う点はその場で書く。

1. 新しいセッションで 1 回送信した。モックに本文のリクエストとタイトル生成のリクエストが届き、応答する。
   バナーは出ず、状態 API は `state: "fresh"` を返す(この 2 点は 0.2.1-rc.1 でだけ見た)。
2. 1 分を過ぎるとバナーが入力欄の上に 1 つ出る(`role="status"`、入力欄の矩形より上)。文言は
   「キャッシュ切れ(最終応答から 1 分)。このまま送ると止められます。」とボタン「次の 1 回を許可(/unlock)」。
   状態 API は `state: "stale"`。
3. 失効したまま送信した。サーバーログに `ブロックしました: <id> (最終応答から 1 分, turn 2 step 1)`。
   セッションログには `agent/inbox/spliced`(入力を受信箱から外す)、`turn/start`、`command/run`(`name: "cache-sentinel"`)、
   `command/done`(`kind: "error"`、本文に「送信を止めました…」と破棄された入力)、`turn/end`(`kind: "blocked"`)の順に並ぶ。
   `step/start` は無く、モックにもリクエストは届かない。
4. バナーのボタンを押しても何も起きない(`command/run` も状態の変化も無い)。#26 の不具合。確認に使った `86a77f6` には修正が入っていない。
   修正はその後 [#34](https://github.com/AliceSaikawa/cache-sentinel/pull/34) で main(`dd07050`)に入った。#34 の実機確認は 0.2.0-rc.2 だけで、0.2.1-rc.1 で修正後のボタンは確かめていない。
5. 入力欄に `/unlock` と入れて Enter を 1 回押した。`command/done` は「次の送信を許可しました。最終応答から N 分経過しているため、
   キャッシュなしの料金になります(許可は 10 分有効)」。状態 API は `state: "unlocked"` と `unlockExpiresAt`。
   30 秒のポーリングのあと、バナーは「次の送信を許可中(キャッシュなしの料金になります)。あと 10 分」になり、ボタンは消える。
6. 送信した。`step/start` と `step/end` があり、モックに届いて応答する。サーバーログに `/unlock の許可で通しました`。
   続けてもう一度送ると、応答直後なのでそのまま通る。
7. 入力欄で `/sentinel` を入れて Enter を押すと「cache-sentinel: モード block(YAML の設定)…」が出る。
8. 最後の応答から 1 分を過ぎてから送信すると、再び拒否される(許可は使い回されない)。
9. RPC(`commands/execute`)で `/sentinel archive` を実行した。`state.json` に `mode: "archive"` と `baselineAt` が入る。
   送信はゲートを通ってモデルに届き、`/unlock` は「入力禁止は無効です(モード: archive)」を返す。
10. 1 分ほど放置すると `1 件をアーカイブしました`。GUI は開いていたセッションから最初の画面に戻り、一覧から消える。
11. RPC の `workspace/unarchiveSession` で解除した。次のサイクルで `手動解除を検出しました: <id>`、`state.json` の
    `unarchivedAt` に記録される。解除から 1 分を過ぎると再びアーカイブされる。
12. 新しいセッションを作って送信し、RPC で `/sentinel block`、`default`、`both`、`off`、`default`、`bogus` を順に実行した。
    いずれも想定どおりの文面を返し、サーバーログに `モードを変更しました: …` が出る。最後の `state.json` から `mode` が消える。
    `bogus` は使い方を返す(`kind: "error"`)。
13. 状態 API を curl で呼んだ。Cookie なしは `401 unauthorized`、Cookie 付きで `sessionId` なしは
    `400 missing sessionId query parameter`、Cookie 付きで `sessionId` ありは 200 で、ブラウザからの取得と同じ JSON を返す。
    付けた Cookie の種類(ブラウザ用か API 用か)は記録に残っていない(下記)。

ブロック通知の行はどちらの版でも DOM にあり、全文が入っている。ただし、ブロックされた turn の折りたたみの中にあるため
`innerText` は空で、最初は見えない(#27 のとおり)。

## 0.2.1-rc.1 の 403 について(README の記述を訂正)

これまでの README は「0.2.1-rc.1 では、ブラウザ以外の接続元からの状態取得 API が 403 になる」と書いていた。
README からこの記述を消した根拠は、実機の結果ではなくコードを読んだ結果で、[spike.md](spike.md) の rc.1 の項目 5 にある。
rc.1 が 403 を返すのは owner 以外の Peer だが、rc.1 の配布物では HTTP で来るリクエストの Peer がすべて owner なので、
この 403(exact route 固有のもの)は配布物のままでは起きない。Host/Origin の検査による 403 はこれとは別で、起きうる。

実機で確かめたことと、コードを読んだだけのことは次のとおり分かれる。

- 実機: Cookie 付きの curl で 200 が返った(手順 13)。ただし、使った Cookie の種類は記録に残っていない。headless chromium が
  持っていたブラウザ用の Cookie(payload の version 1)を付けた可能性がある。その場合、サーバーからは curl もブラウザと
  同じ経路に見え(`admit` が `browserPeer` を返す)、ブラウザ以外の接続元の経路は通っていない。
- コードのみ: ブラウザ以外の接続元の経路は、`/connect` に launch token を付けて受け取る API 用の Cookie(version 2)
  → `authenticateApi` → `publishPeer` で作った Peer。この Peer も owner なので 200 になるはずだが、実機では試していない。
  行番号は spike.md の rc.1 の項目 5。

## 見つかった不具合(両方の版で同じ)

**入力欄に `/sentinel archive` のように引数つきで打つと、コマンドにならず普通のメッセージとして送られる。**

- 0.2.0-rc.2 では、本文 `/sentinel archive` がそのままモデルに届いた(モックの記録に残った)。モードは変わらない。
  0.2.1-rc.1 では失効中だったので、ブロックされて「破棄された入力: /sentinel archive」になった。
- 原因: 公式 UI は `/` で始まる入力を Enter の時点で判定する。引数がある場合は、コマンドの登録に `input`
  (`CommandInputDescriptor`)が無いと `undefined` を返し、普通のメッセージとして送る。
  - 0.2.1-rc.1: `@deepseek-ai/dsh-client-ui-commands/lib/client.js:1661,1665`(`if (desc.input !== void 0)` と `if (!bare) return void 0`)。
    受け側は `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:5182,5208`。
  - 0.2.0-rc.2: 同じ処理が `dsh-client-ui-commands/lib/client.js:1012,1016`、`dsh-client-ui-conversation/lib/client.js:3914,3940`。
    `matchEnter` の本体は 2 つの版で同一。
  - `input` の型は `@deepseek-ai/dsh-commands/lib/types/types.d.ts:20-31,63`(両方の版で同じ)。cache-sentinel の
    `ctx.commands.register` は `input` を渡していない(`src/index.ts:249-253`)。
- 影響: README の「`/sentinel block` | `archive` | `both` | `off`」「`/sentinel default`」は、公式 UI の入力欄からは使えない。
  引数なしの `/sentinel` と `/unlock` は使える。RPC の `commands/execute` では引数つきでも動く(今回の確認はこちらで行った)。
  版の対応範囲とは関係しないので、この記録の PR(#35)では直さない。
- Issue: [#36](https://github.com/AliceSaikawa/cache-sentinel/issues/36)。修正は [#37](https://github.com/AliceSaikawa/cache-sentinel/pull/37)(この記録の時点で未マージ)。それまでの間、README 3 言語の `/sentinel` の節に、入力欄からは
  使えないことを注記した。

## 確認していないこと

- 0.2.1-alpha.1〜alpha.5 の実機。
- `desktop` プロファイル(#16 のとおり、このマシンでは動かせない)。
- 再起動をまたいだモードの維持(C2)、`both` モードのアーカイブ(C3)、`unlockTtlMinutes` 切れ(B4)。
- ブラウザ以外の接続元(`/connect` で受け取る API 用の Cookie)からの状態取得 API(上記「0.2.1-rc.1 の 403 について」)。
- 0.2.1-rc.1 での、#34 で直したバナーのボタン。
- 実在の LLM での応答。今回はモックで、ストリームの形は最小限(テキスト 1 ブロック)。
- 0.2.1-rc.2 以降(2026-10-18 時点の `next` は rc.2)。対応範囲を広げるかは別に扱う。
  → #31 で 0.2.1-rc.2 まで広げた。rc.2 の実機確認はしていない。
