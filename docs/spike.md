# T0 spike 結果 (2026-10-15, DSH 0.2.0-rc.2)

> この文書は開発時の記録です。

調査対象: `<DSH のインストール先>/node_modules/@deepseek-ai/`(以下 `$PK`)。
コードは書いていない。実機動作は T9 で確認する(ここは型定義・実装読解と実ファイル確認まで)。

## U1: Host プラグインの形と inject するサービス — 確定
- 形: `export const name`, `export const inject = [...]`, `export function apply(ctx, config)`、
  設定は `export const Config = z.object({...})`(`import z from '@deepseek-ai/schemastery'`)。
  根拠: `$PK/dsh-hooks-claude-code/lib/index.js:2,114-121,405`、既存例 `dsh-webui-m3e/src/host/index.ts:21-22,110`。
- 使うサービス(`ctx.<name>`):
  | inject 名 | 型 | 根拠 |
  |---|---|---|
  | `workspaceRegistry` | `WorkspaceRegistry` | `$PK/dsh-workspace/lib/types/index.d.ts:80-83` |
  | `sessionPersistence` | `SessionPersistence` | `$PK/dsh-session-persistence/lib/types/index.d.ts` (`declare module` で `Context.sessionPersistence`) |
  | `sessions` | `SessionStore`(ロード済みセッション) | `$PK/dsh-session/lib/types/index.d.ts:27-29`。**名前は `sessionStore` ではなく `sessions`** |
  | `timer` | `ctx.interval(cb, ms)` / `ctx.timeout` | `$PK/cordis-plugin-timer/README.md`、`dsh-base/cordis.patch.yml:24-25` で標準搭載 |
- DSH 本体は依存ではない。`dsh-webui-m3e` と同様、必要な型は `src/host/services.d.ts` に最小限で書き写す(`declare module '@deepseek-ai/cordis'`)。
- ビルド: esbuild で `src/index.ts` → `lib/index.js`、`external: ['@deepseek-ai/*']`、`apply` が export されることを検査(`dsh-webui-m3e/scripts/build-plugin.ts` を踏襲)。

## U2: 最終アクティビティ時刻の取り方 — 確定(仕様を更新)
- `sessionPersistence.list()` は header(`id, cwd, createdAt, origin, parentSession`)・`revision`・`sizeBytes` を返すが、
  **最終イベント時刻は無い**。`eventCount` は JSONL バックエンドでは `stat/list` に入らない
  (`$PK/dsh-session-persistence-jsonl/lib/index.js:2554-2555,2584-2585`)。
- `handle.read()` でログ末尾を読むと zstd ログ全体の展開が必要になり高コスト(`.../jsonl/lib/index.js:62-92`)。→ 採用しない。
- `revision` は `dev:ino:size:mtimeNs:ctimeNs` の連結だが opaque 型(`revision.d.ts`)なので **パースしない**。
- **採用: ログファイルの mtime**。実測で最終イベント `time`=22:20:59.117 に対し mtime=22:20:59.120 とほぼ一致。
  - ログの場所: `<sessionsRoot>/<projectKey(cwd)>/<encodedId>/session.v4.jsonl[.zstd]`
    (`.../jsonl/lib/index.js:903-927`)。`sessionsRoot` 既定は `~/.dsh/sessions`。
    `projectKey` はエンコード関数で非公開のため、**`<sessionsRoot>/*/<id>/session.v*.jsonl*` を走査して id→mtime のインデックスを作る**(約 150 ディレクトリ、サイクル毎に readdir+stat で軽い)。
    ディレクトリ名は `encodeSegment(id)` なので、まず UUID 形式 id は恒等であることを T7 で確認し、そうでなければ `header.id` ではなくディレクトリ名→header の突合で対応。
  - `session.lock` は無視(ログファイルのみ見る)。
- ロード済みセッション: `ctx.sessions.get(id)?.ownEvents()` 末尾の `time` も併用し、`max(mtime, 末尾 time)`。永続化が遅延バッチされる分を補う。
- どれも取れない(未 materialize の新規セッション等): `header.createdAt` を使う。
- 注意: スキーマ移行(v3→v4 等)でログが書き換えられると mtime が新しくなる。誤ってアーカイブ**が遅れる**側なので許容。

## U3: ピン留め — 確定
- `ctx.workspaceRegistry.pinnedSessionIds: readonly SessionId[]`。`archivedSessionIds` も同様の getter。
- `archiveSession` はピンを外す(`index.d.ts` の doc コメント)。よって `skipPinned` は仕様どおり必須。

## U4: 手動アーカイブ解除の通知 — 確定(イベントなし → ポーリング差分)
- `WorkspaceRegistry` が宣言するイベントは `workspace/session-activity` と `workspace/session-stop` のみ。
  archive/unarchive の変更通知イベントは無い(`index.d.ts:80-110`)。
- → 仕様 §5 のとおり `archivedSessionIds` をサイクル毎に前回と比較。サイクル間隔(60s)内の
  「解除→即再アーカイブ」は起きない(プラグインが再アーカイブするのは idle>60 分のみ)ので差分検出で十分。

## U5: 導入方法 — 確定
- プロファイルに追加: `dsh plugin --profile web add file:/path/to/cache-sentinel-<ver>.tgz`(`dsh-webui-m3e/README.md:22,72`)。
- `package.json` に `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`、`cordis.patch.yml`:
  ```yaml
  - insert:
      - id: cache-sentinel
        name: cache-sentinel
  ```
  (`dsh-webui-m3e/cordis.patch.yml`)。設定は同じ行の `config:` に書く。
- `main`: `lib/index.js`。`files`: `["lib/index.js","cordis.patch.yml"]`。

## アーカイブ API の挙動(実装上の注意)
- `archiveSession(id)` は `stopActivity` なしだと、実行中作業があれば `WorkspaceActiveSessionError` を投げて**何も書かない**。
  `WorkspaceUnknownSessionError`(型名は `index.d.ts:24-34` 付近)もあり得る → どちらも warn/debug で継続。
- 既にアーカイブ済みの id は no-op。
- `archivedSessionIds` / `pinnedSessionIds` は同期 getter なのでサイクル開始時にスナップショットを取る。

## 仕様への反映 (spec v0.2)
- §2: 最終イベント時刻 → 「ログファイル mtime と、ロード済みなら末尾イベント `time` の大きい方」へ変更。
- §11: U1〜U5 を解決済みに更新。
- 新たな未確認: V1 `encodeSegment(id)` が UUID で恒等か、V2 実機で archiveSession がプラグインから呼べるか(T9)。

---

# 閲覧のみ方式の調査 (2026-10-15, DSH 0.2.0-rc.2) — spec v0.3 の根拠

`$PK` = `<DSH のインストール先>/node_modules/@deepseek-ai`

## W1: ステップを止める口 — `agent/pre-step`(確定)
- 型: `$PK/dsh-agent/lib/types/runtime-types.d.ts:304-310`。waterfall。`{ kind: 'reject' }` を返すと拒否。
  payload は `{ agent, messages, turn, step, signal }`、`agent.session` で Session に届く(同 `:143`)。
- 拒否の効果: `$PK/dsh-agent-loop/lib/index.js:902-924,958-961`。受信箱から claim 済みの入力は破棄され、
  ターンは `{ kind: 'blocked' }` で終わる。`step/start` も書かれず、リクエストは出ない。
  hooks-claude-code の README も「blocked prompt is discarded ... ending the turn as blocked」(`$PK/dsh-hooks-claude-code/README.md:157`)。
- 既存の同種実装: アーカイブのゲート `$PK/dsh-api-session-controller/lib/index.js:2430`。

## W2: 自動圧縮もこの waterfall 内でモデルを呼ぶ → `prepend` が必須(確定)
- `$PK/dsh-compaction-basic/lib/index.js:839-852` が `agent/pre-step` 内で `compactIfNeeded` を実行してから `next()`。
- cordis の waterfall は登録順に外側から呼ぶ(`$PK/cordis/lib/index.js:317-325`)。`ctx.on(name, cb, { prepend: true })` で先頭に入る
  (`$PK/cordis/lib/types/events.d.ts:101-104`, `index.js:336`)。

## W3: 他にモデルを呼ぶ経路(確定)
- 有効なもの(`pluginInventory/list` で確認): `session-title-first-prompt-llm`(最初の送信時のみ)、`experimental-auto-review`(ターン内のツール実行前のみ)。
  ゴール継続・リマインダー・サブエージェントはすべて Agent のステップ = `agent/pre-step` を通る。

## W4: 最終応答時刻(確定)
- `step/end` イベント(`$PK/dsh-session/lib/types/types.d.ts:283-286`)の `time`。
- Session API: `snapshotEvents()`, `eventAt(seq)`, `ownEvents()`(`$PK/dsh-session/lib/types/index.d.ts`)。
  フォークの引き継ぎ部分も含めるため `snapshotEvents()` を使う。
- 増分: `'session/event'(session, event)`(同 `index.d.ts:64`)。

## W5: スラッシュコマンド(確定)
- `ctx.commands.register({ name, description, handler })`、handler は `{ agent, rawInput, signal, ... }` を受け、
  `{ kind: 'success', text? } | { kind: 'error', text }` を返す。結果はモデル履歴に入らず GUI に表示
  (`$PK/dsh-commands/lib/types/index.d.ts:19-54`, `types.d.ts:30-42`, README)。`unlock` という既存コマンドはない。

## W6: プラグインの停止(確定・実施済み)
- profile の `cordis.patch.yml` に `- id: cache-sentinel` / `disabled: true` で停止。ライブ反映され、
  `pluginInventory/list` で `enabled: false, fiberPhase: null` を確認(21:30)。

---

# DSH 0.2.1 系との互換調査 (2026-10-17) — README の対応範囲拡大(0.2.0-rc.2〜0.2.1-rc.1)の根拠

`$PK` = 各版の `node_modules/@deepseek-ai`。方法は、npm から 0.2.1-alpha.1〜alpha.5 と 0.2.1-rc.1 の
該当パッケージを取得し、型定義(`lib/types/*.d.ts`)と実装(`lib/index.js` など)を 0.2.0-rc.2 と diff したもの。
行番号は特記なければ rc.1 のもの。この調査の時点では DSH の実機起動はしていない。0.2.0-rc.2 と 0.2.1-rc.1 の実機確認は
2026-10-18 に同じ手順で行った([dsh-version-check.md](dsh-version-check.md))。
同じ比較は `scripts/dsh-compat.ts` で再実行できる(使い方は README の Development 節)。

## lib の一致状況(package.json と CHANGELOG を除く)
- alpha.3〜alpha.5 は rc.1 と一致。例外は dsh-client-modules(alpha.3〜5。rc.1 でリリース一致ゲートが追加)、
  dsh-client-ui-conversation と dsh-web-app(alpha.3 のみ。コマンドチップと tool-plugin-market の preset)。
- alpha.1 / alpha.2 は中間の状態。base と compaction-basic は 4 版で同一。agent-loop と headless は
  alpha.1 = rc.2、alpha.2 = rc.1。slots と workspace は alpha.1 / alpha.2 とも rc.2 と同一。
- cordis は 4.0.4 / 4.0.5-alpha.1 / 4.0.5 で lib が同一。

## 項目ごと
| 項目 | alpha.1 | alpha.2 | alpha.3〜5 | rc.1 |
|---|---|---|---|---|
| 1 `agent/pre-step` | 変更なし | 変更なし | 変更なし | 変更なし |
| 2 Session / command イベント | 変更なし | 内部実装のみ | 変更なし | 変更なし |
| 3 `commands.register` | 変更なし | 変更なし | 変更なし | 変更なし |
| 4 `workspaceRegistry` / `sessionPersistence.list()` | 変更なし | 任意項目 `formatStatus` の追加のみ | 同左 | 同左 |
| 5 `connection.fetch.register` | 変更なし | 型は同じ(信頼判定の変更のみ) | 同左 | 型は同じ。owner 以外の Peer に exact route が 403(配布物の HTTP 経路では owner 以外の Peer は無い) |
| 6 セッションログの配置 | 変更なし | 変更なし | 変更なし | 変更なし |
| 7 クライアント(`dsh.client`・`conversation.input.dock`・`remote.commands.execute`) | 変更なし | 変更なし | 変更なし | 変更なし |
| 8 バンドルの提供サービス | 変更なし | 変更なし | 変更なし | 変更なし |

壊れる箇所は見つからなかった。比べたパッケージは dsh-agent、dsh-agent-loop、dsh-compaction-basic、
dsh-session、dsh-commands、dsh-workspace、dsh-session-persistence(-jsonl)、dsh-client-connection、
dsh-client-modules、dsh-client-ui-conversation、dsh-client-ui-slots、dsh-client-ui-chat、dsh-base、
dsh-web-app、dsh-headless、cordis。

## 根拠(rc.1)
1. pre-step: payload `{agent, messages, turn, step, signal}` は `$PK/dsh-agent/lib/types/runtime-types.d.ts:304-310`、
   `PreStepDecision` は同 `:92-99`。reject するとターンは `blocked` で終わる
   (`$PK/dsh-agent-loop/lib/index.js:909-922,961`)。`$PK/dsh-compaction-basic/lib/index.js` は rc.2 と同一で、
   `:839-841` で pre-step 内から `compactIfNeeded` を呼ぶ。cordis の prepend は
   `$PK/cordis/lib/index.js:336`(unshift)。prepend の pre-step リスナーは dsh-agent(`index.js:204`)と
   dsh-session-reference(`index.js:477`)で、どちらも先に `next()` を呼び、reject はそのまま返す。
   dsh-subagent-in-process-driver は alpha.1 まで存在し(prepend なし、`next()` の結果を素通し)、alpha.2 以降は廃止。
2. Session: `session/event` は `$PK/dsh-session/lib/types/index.d.ts:61`、`snapshotEvents` `:224`、
   `ownEvents` `:231`、`append` `:277`(`time: Date.now()` を付ける)。`step/end` は `types.d.ts:284`。
   `command/run` / `command/done` の形は `$PK/dsh-commands/lib/types/types.d.ts:101-118`。
   rc.1 で run/done の対応を検査する invariant が削除されたが、cache-sentinel は対で書くので影響なし。
   alpha.2 で append の内部実装が `publicationEntry`/`commit` に分かれたが挙動は同じ。
3. commands: `$PK/dsh-commands/lib/types/index.d.ts:18-54,94`、`CommandResult` は `types.d.ts:33-41`。
4. workspace: getter は `$PK/dsh-workspace/lib/types/index.d.ts:196,231`、`archiveSession` は `:214`。
   エラー型と実装は同一。`list()` の結果に任意の `formatStatus`
   (`$PK/dsh-session-persistence/lib/types/index.d.ts:25-26`、alpha.2 以降)。
5. connection: 提供元は `@deepseek-ai/dsh-client-connection`(dsh-web-app の `id: connection` 行)。
   `ConnectionFetchRoute` は `rpc.d.ts:119-132`、`register` は `:140`。rc.1 では owner 以外の Peer に 403
   (`lib/index.js:830`)。ブラウザは owner(`:714`)。
   訂正(2026-10-18、実機確認のあと): rc.1 の配布物では、HTTP で来るリクエストの Peer は owner しかない。
   HTTP の受け口 `admit`(`lib/index.js:742-750`)が返す Peer は、ブラウザ用(`:714`)か `publishPeer`(`:781-790`)で
   作ったもので、どちらも `principal: { kind: "owner" }`。`Principal` の元になる `PrincipalMap` にも `owner` しか無い
   (`$PK/dsh-typert-protocol/lib/types/types.d.ts:363-370`)。
   `admit` は、Cookie の payload が version 1(ブラウザ用。`:278`・`:546-548`)なら `browserPeer` を返す(`:746`)。
   ブラウザ以外の接続元は、`/connect` に launch token を付けて version 2 の API 用 Cookie を受け取り(`:505-538`)、
   `authenticateApi`(`:555-558`)で `publishPeer` の Peer に解決される(`:747-749`)。
   `peers.set` は `publishPeer` の中(`:786`)にしか無く、`createPeer`(`:752`)で作った Peer が HTTP の fetch handler
   (`:868`・`:1055`、どちらも `admit` の結果を渡す)に届く経路は無い。
   したがって以前の README の「ブラウザ以外の接続元は 403」は誤り。exact route 固有の 403(`:830`)は、rc.1 の HTTP 経路では
   プラグインの有無にかかわらず起きない。Host/Origin の検査による 403(`:743`、応答は `:1050-1052`)はこれとは別で、
   この route でも起きる。
   実機では Cookie 付きの curl で 200 が返った([dsh-version-check.md](dsh-version-check.md) の手順 13)が、使った Cookie の
   種類は記録に残っていない。ブラウザ用の Cookie だった可能性があり、`/connect` の API 認証の経路は上のとおりコードを
   読んで確認しただけで、実機では通していない。
6. ログ配置: `$PK/dsh-session-persistence-jsonl/lib/index.js:745-965` は rc.2 と同一。`encodeSegment`
   (`:858`)は `~XXXX`、ファイル名は `session.v4.jsonl[.zstd]`、`SESSION_FORMAT_VERSION` は 4。
   root は dsh-base の `dshHomePath('sessions')`。
7. クライアント: `dsh.client` の解析は `$PK/dsh-client-modules/lib/index.js:66-74,733-745`、inject の
   先行読み込みは `client.js:789`。`conversation.input.dock` は
   `$PK/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:295`。
8. バンドル: `headless` = dsh-base + dsh-headless、`web` = dsh-base + dsh-web-app。dsh-base は
   `timer`・`sessions`・`sessionPersistence`・`commands` を提供。`workspaceRegistry` と `connection` は
   dsh-web-app だけ。そのため headless では cache-sentinel は起動しない(全版共通)。

## rc.2 の追加調査 (2026-10-23) — 対応範囲を 0.2.1-rc.2 まで広げる根拠

`node scripts/dsh-compat.ts /var/tmp/dsh-compat 0.2.1-rc.1 0.2.1-rc.2` を実行した。16 パッケージ中 diff は
dsh-client-modules・dsh-base・dsh-web-app の 3 つで、他の 13 は `package.json` を除いて rc.1 と同一。
行番号は特記なければ rc.2 のもの。

| 項目 | rc.2 |
|---|---|
| 1 `agent/pre-step` | 変更なし(dsh-agent・dsh-agent-loop・dsh-compaction-basic が rc.1 と同一) |
| 2 Session / command イベント | 変更なし(dsh-session・dsh-commands が同一) |
| 3 `commands.register` | 変更なし(dsh-commands が同一) |
| 4 `workspaceRegistry` / `sessionPersistence.list()` | 変更なし(dsh-workspace・dsh-session-persistence(-jsonl) が同一) |
| 5 `connection.fetch.register` | 変更なし(dsh-client-connection が同一) |
| 6 セッションログの配置 | 変更なし(dsh-session-persistence-jsonl が同一) |
| 7 クライアント(`dsh.client`・`conversation.input.dock`・`remote.commands.execute`) | 変更なし(dsh-client-modules の差分はビルド識別子 1 行のみ。dsh-client-ui-conversation・dsh-client-ui-slots は同一) |
| 8 バンドルの提供サービス | 変更なし。dsh-base の差分は web / web-deepseek-api の行の追加、dsh-web-app の差分は行の追加のみで、いずれも `workspaceRegistry`・`connection`・`timer`・`sessions`・`sessionPersistence`・`commands` の行は変わらない |

1〜8 の根拠:
1. `$PK/dsh-agent/lib/types/runtime-types.d.ts` と `dsh-agent-loop/lib/index.js` が rc.1 と同一(pre-step の
   payload・`PreStepDecision`・reject 時の `blocked` 終了・prepend の扱いも同じ)。
2. `$PK/dsh-session/lib/types/*.d.ts` と `lib/index.js`、`$PK/dsh-commands/lib/types/types.d.ts` が同一。
3. `$PK/dsh-commands/lib/types/index.d.ts` が同一。
4. `$PK/dsh-workspace/lib/types/index.d.ts`、`$PK/dsh-session-persistence/lib/types/index.d.ts`、
   `$PK/dsh-session-persistence-jsonl/lib/index.js` が同一。
5. `$PK/dsh-client-connection/lib/index.js` と `lib/types/rpc.d.ts` が同一。
6. `$PK/dsh-session-persistence-jsonl/lib/index.js` が同一(ログの配置・ファイル名・`SESSION_FORMAT_VERSION`)。
7. クライアント: `$PK/dsh-client-modules/lib/index.js:540` の `const commit = "332895e"` だけが rc.1 の
   `"ed75efe"` と違う(どちらもファイル全体で 42,376 バイト)。`dsh.client` の解析・inject の先行読み込みの
   コードは rc.1 と同一行。`conversation.input.dock` のスロット契約(`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`)も同一。
8. バンドル: `$PK/dsh-base/cordis.patch.yml:475-479` が `web-deepseek-api` の行を足しただけ
   (同ファイルの 464-466 のコメントも更新)。`$PK/dsh-web-app/cordis.patch.yml:415-417` が
   `ui-deepseek-model-label-1017` の行を足しただけ。どちらも cache-sentinel が inject するサービスの行ではない。

壊れる箇所は rc.2 でも見つからなかった。rc.2 は「型と実装の比較」で確認した範囲で、実機での確認は別。

---

# 対応 DSH 版の宣言とその評価 (2026-10-23, DSH 0.2.1-rc.2) — Issue #31

`$PK` = `/home/user/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`(以下「現行版」)。
比較用の旧版(0.2.0-rc.2)は `npm pack @deepseek-ai/<名前>@0.2.0-rc.2` で取得した tarball を展開したもの。
以下「0.2.0-rc.2 の `dsh-app-boot/lib/index.js`」などは、その tarball 内のパス(`package/` を除く)。
`@deepseek-ai/dsh@0.2.0-rc.2` は `dsh-app-boot`・`dsh-plugin-manager` をどちらも `0.2.0-rc.2` に固定している
(0.2.0-rc.2 の `dsh/package.json:33,100`)。

## K1: どのフィールドを評価するか — 確定

- プラグインの `package.json` を見る。評価するのは **`engines.dsh` が最優先で、あれば `peerDependencies` は
  見ない**。無ければ `peerDependencies` のうち **`@deepseek-ai/dsh` と `@deepseek-ai/dsh-*` の名前だけ** を見る。
  それ以外の名前の peer(例: `@deepseek-ai/cordis`)は範囲に含まれない。宣言がどちらも無ければ制約なし。
  根拠: 現行版 `dsh-app-boot/lib/index.js:280-299`(`unmetRequirements`)、同じ説明が
  `dsh-app-boot/README.md:52`。
- 比較は **semver の `satisfies(runtimeVersion, range, { includePrerelease: true })`**(同 `:276-277`)。
  prerelease(rc / alpha)も範囲に参加する。空文字の範囲は不一致、`engines.dsh` の `workspace:` も不一致。
  ただし peer の `workspace:^` / `workspace:~` / `workspace:*` は現行 runtime と同値とみなす(同 `:290-295`)。
- runtime 版は `@deepseek-ai/dsh-app-boot` 自身の `package.json` の `version`(同 `:270-275`)。現行版では
  どちらも `0.2.1-rc.2`(`dsh/package.json:4`、`$PK/dsh-app-boot/package.json:4`)。
- 0.2.0-rc.2 にも同じ仕組みがある(やや古い形)。根拠: 0.2.0-rc.2 の `dsh-app-boot/lib/index.js:286-313`
  (`evaluatePluginCompatibility`)、拒否の文面は `:320-323`。
  - `engines` は見ず、`peerDependencies` の `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` を
    `includePrerelease: true` で比較する(`:289-300`)。`workspace:` の扱いと「空範囲は不一致」も同じ。
  - 評価する場所も現行版と同じで、起動時の plugin 行(`:2079`)と、プロファイルのバンドル(`dsh.profile.bundles`)の
    両方。バンドルは `loadProfileDirectory` が `evaluatePluginCompatibility(bundleManifest, exemptions)` を呼び
    (`:930`)、合わなければ throw して `skippedBundles` に入れる(`:931`・`:940-945`)。
  - 0.2.0-rc.2 に無いのは `engines.dsh` の扱いだけ。インストール時の事前検査は 0.2.0-rc.2 にもある(K2)。

## K2: どの段階で検査するか — 確定

- **インストール時**(`dsh plugin add` / `install`): pnpm を実行する前に検査する。ローカルのパス指定は
  その `package.json` を読み、レジストリ指定は選ばれる版の `engines` と `peerDependencies` を見る。
  満たさない場合は pnpm を実行せずに操作を拒否する(ダウンロードもビルドスクリプトも走らない)。
  git・tarball 指定は取得そのものが要るため、インストール後に判定し、プロファイルの `package.json` と
  ロックファイルを元に戻す。根拠: `$PK/dsh-plugin-manager/README.md:69`。
  0.2.0-rc.2 でも同じで、`@deepseek-ai/dsh@0.2.0-rc.2` が依存する `dsh-plugin-manager@0.2.0-rc.2` の `README.md:63` と
  `lib/index.js:500-514` で、pnpm を動かす前に `evaluatePluginCompatibility` で判定し、合わなければ
  「nothing was installed」で拒否する(レジストリ指定は registry から選ばれる版の `package.json` を見る)。
  0.2.0-rc.2 は `engines` を見ないので、見るのは peer だけ。
- **プロファイル起動時(バンドル)**: cache-sentinel は `dsh.bundle.patch` を持つバンドルで、`dsh plugin add` で
  入れるとプロファイルの `dsh.profile.bundles` に入る(`$PK/dsh-plugin-manager/README.md:40`
  「Installation enables a new bundle by default」)。バンドルは読み込む前に評価され(現行版
  `dsh-app-boot/lib/index.js:1025-1026`)、満たさなければ catch で `skippedBundles` に入る(`:1035-1040`)。
  起動時に `:537-538` が stderr に `skipping profile bundle "cache-sentinel": <理由>` と出す。
  スキップされたバンドルは patch(`cordis.patch.yml`)ごと読まれないので、Host の行も、行から読み込まれる
  クライアント(`dsh.client`)も無くなる(クライアントは有効な Loader の行から集める: `$PK/dsh-client-modules/README.md:12`)。
  cache-sentinel に主に効くのはこのバンドル単位のスキップ。
- **プロファイル起動時(plugin 行)**: 構成する各行も、読み込む前に評価する。満たさない行は `disabled` にして
  `stderr` に理由を出し、**そのプラグインは読み込まない**(起動全体は止まらない)。
  根拠: 現行版 `dsh-app-boot/lib/index.js:2311-2345`(`preflight`、`evaluatePluginCompatibility` は `:2327`)、
  拒否の文面は同 `:333-336`。cache-sentinel の行はバンドルの patch から来るので、バンドルが読み込まれたときの
  二重の検査になる。免除のキーはどちらも `cache-sentinel@<版>`(`:316-318`)なので、同じ免除で両方を通る。
- 免除: プロファイルの `compatibility.json` に「`<プラグイン名>@<版>` → 許可する DSH の完全な版の一覧」を
  書く。**プラグインの版と DSH の版の組ごとの完全一致**で、範囲では書けない。付与は
  `dsh plugin --profile <profile> allow-version <package@version> --dsh-version <runtime> --accept-risk`、
  取り消しは `revoke-version`、一覧は `version-exemptions`。
  根拠: `$PK/dsh-plugin-manager/README.md:71-75`、`@deepseek-ai/dsh/README.md:39`(DSH 本体のパッケージ直下)、現行版
  `dsh-app-boot/lib/index.js:336-345,415-425`。
- 0.2.0-rc.2 にもインストール時・起動時の拒否と免除はある(0.2.0-rc.2 の `dsh-app-boot/lib/index.js:322` の文面に
  `dsh plugin allow-version` が出る。CLI は `dsh-plugin-manager/README.md:69`)。無いのは `engines.dsh` だけ(K1)。

## K3: 公式プラグインの宣言 — 確定

- 現行版の `@deepseek-ai/dsh-*` 294 パッケージ中 171 が DSH の peer を宣言している(DSH 本体の
  `node_modules` 以下にある `@deepseek-ai/dsh-*` の `package.json` を、入れ子の `node_modules` も含めて集め、
  `name@version` で重複を除いて数えた)。**すべて
  `peerDependencies` に `"<name>": "<正確な版>"`(例: `"@deepseek-ai/dsh-agent": "0.2.1-rc.2"`)で、
  `engines` を持つものは 1 つも無い。**
- したがって外部プラグインが広い範囲を宣言する例は DSH 本体には無い。cache-sentinel は対応範囲が
  「同一リリースではない複数の版」なので、正確な版ではなく範囲を書く。評価は K1 の `satisfies` なので範囲でよい。

## K4: 宣言する範囲 — 確定

`peerDependencies` に `"@deepseek-ai/dsh": ">=0.2.0-rc.2 <=0.2.1-rc.2"` を書く(`engines.dsh` は使わない。
K3 のとおり公式の前例が無く、`engines.dsh` を書くと peer を書いても無視されるため、片方に絞る)。

現行版と同じ semver(`$PK/../semver/index.js`、7.8.5)の `satisfies(v, range, { includePrerelease: true })` で
評価した結果:

| DSH の版 | 範囲内か |
|---|---|
| 0.2.0-rc.1(以前) | 範囲外 |
| 0.2.0-rc.2 | 範囲内 |
| 0.2.1-alpha.1〜alpha.5 | 範囲内 |
| 0.2.1-rc.1 | 範囲内 |
| 0.2.1-rc.2 | 範囲内 |
| 0.2.1-rc.3 | 範囲外 |
| 0.2.1(正式版) | 範囲外 |
| 0.2.2 / 0.3.0 | 範囲外 |

- `<=0.2.1-rc.2` は semver の順序で「0.2.1-rc.2 まで」を意味し、`0.2.1-rc.3` と `0.2.1` は入らない。
  一方 `0.2.0-rc.2` 〜 `0.2.1-rc.2` の間にある prerelease はすべて入る(0.2.1-alpha.1〜alpha.5 を含む)。
  実機で確認していない alpha 系が範囲に入るのは、Issue #12 の対応範囲(README の記載)と同じ考え方。
- 検討した別案: `<0.2.1` は 0.2.1-rc.3 が入るため不可。`^0.2.1-rc.2` は 0.2.0-rc.2 と alpha 系が入らないため不可。
  `>=0.2.0-rc.2` だけでは 0.2.2 以降も入るため不可。
- 正式版 `0.2.1` は範囲に入れない(2026-10-23 時点で未リリース。入れると未確認の版を許可することになる)。

## K5: 宣言の副作用 — 確定(注意点)

- この宣言により、**範囲外の DSH では K2 のとおり拒否される**。cache-sentinel はバンドルとして評価されるので、
  起動時はバンドル単位でスキップされ(Host もクライアントも読み込まれない)、起動自体は続く。
  インストール時は pnpm を動かす前に拒否される。免除は `compatibility.json` に完全一致の版の組で書く必要があり、
  範囲では免除できない。
- 上限を固定しているので、DSH の rc.3 や 0.2.1 正式版が出ると、更新した時点で cache-sentinel は自動でスキップされ、
  入力禁止などのガードが外れる(fail-open)。気づく手がかりは起動時の stderr の `skipping profile bundle` だけ。
  Issue #31 の意図どおり(未確認の版では動かさない)だが、新しい版が出たら K6 の手順で範囲を見直す。
- インストール時の事前検査は「プロファイルの依存を解決した版の `package.json`」を見るため、
  `github:` 指定では取得後、レジストリ指定では選ばれる版の宣言が評価される。

## K6: 新しい DSH の版が出たときの手順

1. 互換調査: `node scripts/dsh-compat.ts <作業ディレクトリ> <範囲の上限の版> <新しい版>` で、cache-sentinel が使う
   パッケージの差分を取る(使い方は README の Development 節)。差分があれば、上の「DSH 0.2.1 系との互換調査」の
   項目 1〜8 に照らして影響を調べ、この文書に追記する。壊れる箇所があれば、範囲を広げる前に直す。
2. 宣言の更新: `package.json` の `peerDependencies` の上限(`<=<版>`)を新しい版にする。正式版や次の minor に
   広げる場合は、K4 の表のように範囲内・範囲外の版を挙げて `satisfies` の結果を確かめる。
3. テストの更新: `tests/package.test.ts` の宣言の値を新しい範囲にする。README 3 言語に同じ範囲が書かれているかも
   同じファイルのテストで確かめている。
4. README 3 言語の「Supported Versions and Environment」を更新する: 見出しの範囲、宣言の値、新しい版を
   「実機で確認」か「型と実装の比較のみ」かに分けて書く。実機で確かめた場合は記録を `dsh-version-check.md` に足す。
5. `pnpm test` と `pnpm typecheck` を通す(`src/` を変えた場合は `pnpm build` も)。

---

# 表示言語の調査 (2026-10-17, DSH 0.2.0-rc.2)

## X1: DSH の UI 言語設定 — 確認
- DSH は UI 言語の設定を Host の user-settings 文書に `locale.preference` として持つ
  (`$PK/dsh-client-locale/lib/types/locale-settings.d.ts:1-19`)。設定が無ければブラウザの言語に委ねる。
- ブラウザ側では `ctx.locale.getSnapshot().active` で現在の言語 id を読める
  (`$PK/dsh-client-locale/lib/types/client/index.d.ts:49-56,97-136`。使用例 `$PK/dsh-client-ui-settings-account/lib/client.js:4346`)。
- 組み込みの言語 id は `zh` / `en` の 2 つ(`LOCALE_IDS`、同 `locale-settings.d.ts:10`)。
- cache-sentinel はこれを使わず、Host は環境変数(`LC_ALL` / `LC_MESSAGES` / `LANG`)と `Intl`、
  クライアントは `navigator.languages` で言語を決める(`docs/spec-ui.md` §F)。
  設定の読み取り口やクライアントの `inject` を増やさないため。

---

# github: 指定でのインストールの調査 (2026-10-17, DSH 0.2.0-rc.2)

## G1: `dsh plugin add github:owner/repo` — 確認
- プラグインマネージャーは spec を pnpm に渡す前に分類し、git の指定は `kind: 'git'` になる
  (`$PK/dsh-plugin-manager/lib/types/install-spec.d.ts:6-31,49`、`index.d.ts:89`)。取得は pnpm が行う。
- pnpm は git のパッケージをリポジトリの中身のまま使い、`prepare` などのスクリプトが無ければビルドしない。
  cache-sentinel はスクリプトでビルドしない方針(issue #14 の候補 3 を採らない)なので、
  `lib/index.js`・`lib/client.js` をコミットする。ビルド結果との一致は CI で検査する。
- rustdsh は第三者のプラグインを `dsh plugin --profile "$PROFILE" add github:owner/repo` で入れる
  (rustdsh `plugins/install.sh` 3ce1ad8 `:311-319`)。

## G2: `package.json` の `icon` — 確認
- `icon` は package.json のあるディレクトリからの相対パスで、SVG / PNG / JPEG / WebP、256 KiB 以下、
  realpath 後もそのディレクトリ内にあること(`$PK/dsh-package-manifest/lib/types/types.d.ts:14-15`)。
- DSH はプラグインのコードを評価せず、export した `./package.json` から表示名と icon を読む
  (`$PK/dsh-app-boot/lib/types/package-meta.d.ts:11-24`)。cache-sentinel は `exports['./package.json']` を持つ。
  icon の読み込みに失敗しても表示名は残る(同 `:14`)。

---

# クライアント側 `remote.commands` の inject (2026-10-18, DSH 0.2.0-rc.2)

`$PK` = `<DSH のインストール先>/node_modules/@deepseek-ai`。Issue #16 の確認(web プロファイルの実機)で見つかった
(詳細は `rdsh-check.md`。不具合は #26)。

- クライアントプラグインで `remote.commands` を使うには、クライアントの `inject` に
  `"remote"` とは別に `"remote.commands"` を宣言する必要がある(独立したサービスキー)。
  cache-sentinel のクライアントは `inject = ['slots', 'remote']` だったため、
  ボタン押下時の `remote.commands.execute` で例外になった。
- 公式プラグインは両方を宣言している(例):
  `$PK/dsh-client-ui-plan/lib/client.js:605-614`(`"remote"` と `"remote.commands"`)、
  `$PK/dsh-client-ui-commands/lib/client.js:752-757`(同)。
- 宣言が無い場合の例外メッセージは `cannot get property "remote.commands" without inject`
  (`$PK/cordis/lib/index.js:676`の proxy `get` が投げる。`apply` の時点で `remote` だけを
  読んでいると、サービスに触った時点で初めて失敗する)。
- あわせて、`remote.commands.execute` の戻り値は union(`{ok: false, error} | {ok: true, value}`)で、
  公式は `if (!result.ok) throw` で扱う(`$PK/dsh-client-ui-commands/lib/client.js:1068-1069`)。
  戻り値を捨てると実行失敗が無言になる。
- 型(#26 の修正時に確認): `execute(agentId, line, attachments, signal?): Promise<RemoteResult<object | undefined>>`
  (`$PK/dsh-api-session-controller/lib/types/client/sessions/remotes.d.ts:14-16`)。`RemoteResult` は
  `{ ok: true, value } | { ok: false, error: RemoteFailure }`(`$PK/dsh-typert-protocol/lib/types/types.d.ts:67-73`)。
  `value === undefined` はコマンドが見つからない(公式は「unknown or malformed command」を返す:
  `$PK/dsh-client-ui-commands/lib/client.js:1070-1073`)。`error` の `code`・`message` は同じ箇所の使い方による。
  DSH 自身の Session クライアントも `inject` に `'remote'` と `'remote.commands'` を並べている
  (`$PK/dsh-api-session-controller/lib/types/client/index.js:10-18`)。

---

# 対象プロファイルの調査 (2026-10-18, DSH 0.2.0-rc.2) — #15

結論: 対象は `dsh-web-app` バンドルを含むプロファイル(`web`・`desktop`、`web` のテンプレートから作ったもの)。
headless などでは起動しない(README「Supported Versions and Environment」)。案 2(`workspaceRegistry` と
`connection` を任意の依存にする)は、headless では止めても `/unlock` する手段がなく #7 の方針とあわせて
決める必要があるため採らなかった。`$PK` は rc.2 の `node_modules/@deepseek-ai`。

- 同梱テンプレート: `acp` = base + acp-app、`web` = base + web-app、`headless` = base + headless、
  `sdk` = base + sdk-app、`sdk-minimal` = sdk-minimal のみ(`$PK/dsh-app-boot/lib/index.js:529-535`)。
  テンプレートの無い名前を `dsh plugin` で初期化すると base のみ(同 `:543`)。
- `workspaceRegistry` は `dsh-workspace`(`$PK/dsh-workspace/lib/types/index.d.ts:80-83`)、`connection` は
  `dsh-client-connection`。どちらも行があるのは `$PK/dsh-web-app/cordis.patch.yml:91-92,216-217` だけで、
  dsh-base・dsh-headless・dsh-acp-app の `cordis.patch.yml` には無い。sdk-app / sdk-minimal は rc.2 の
  インストールに含まれず未確認。
- 必須の依存が揃わないプラグインは `PENDING`(待機)のままで、`apply` は呼ばれない
  (`$PK/cordis/lib/types/fiber.d.ts:59-66`)。そのため `[cache-sentinel]` の開始ログも出ない。
- `desktop` は Electron 側が持つプロファイルで、構成はこの checkout に無い。web-app バンドルを使う根拠は、
  `$PK/dsh-web-app/cordis.patch.yml:45-59,277-280` に `profileContext.name !== 'desktop'` で切り替える行があることと、
  `$PK/dsh-web-app/README.md:80` の「Desktop compositions using this bundle」。実機では未確認(#16)。
- npm 版 CLI は `desktop` のプラグイン管理を拒否し、Desktop に同梱の `dsh` コマンドで管理する
  (`dsh/README.md:20`)。

---

# 止める対象の判定材料の調査 (2026-10-18, DSH 0.2.0-rc.2) — #7

結論: `agent/pre-step` の payload だけで「ユーザーの送信で始まるターンの最初のステップ」を判定できる。
ターン内の位置は `step`(ターンごとに 1 から数える)、入力の出どころは `messages[].source.kind` で分かる。
spec.md §3 の `classifyStep` はこれに基づく。`$PK` は rc.2 の `node_modules/@deepseek-ai`。実機での確認はしていない。

## P1: ターン内の位置 — `step`
- payload は `{ agent, messages, turn, step, signal }`(`$PK/dsh-agent/lib/types/runtime-types.d.ts:304-310`)。
- `turn()` は `step = phase.step + 1` で提案し(`$PK/dsh-agent-loop/lib/index.js:953`)、`phase.step` は
  ドライバの開始時(`:865`)とターンの終わり(`:1038`)に 0 に戻る。そのためターンの最初のステップは常に `step === 1`。
- 最初のステップは `target = "next-turn"` で、`next-step` の入力すべてと `next-turn` の先頭 1 件を claim する
  (`:949`, `:103-111`)。2 ステップ目以降は `next-step` だけ(`:1006`)。アイドル中の steer も最初のステップに入る。
- ツールの結果は Session のイベントで、`messages` には入らない。ツール実行中の context は `next-step` に足される(`:1154`)。
  長いツール実行の後の続きは `step >= 2` で、`messages` は空か、inject された context だけ。
  ただし直前の `step/end` がツールの後に書かれるので、このステップは通常失効と判定されない(P3)。
- `messages` は受信箱から claim した入力だけ。runtime context(時刻など)は既定の `next()` が後から足す(`:911-918`)。

## P2: 入力の出どころ — `source.kind`
- `UserMessage` は `source: MessageSource` を必ず持つ(`$PK/dsh-llm/lib/types/message.d.ts:125-133,144-146`)。
  `MessageSource` は `MessageSourceMap` の値の union で、各プラグインが拡張する(同 `:101-122`)。
- 出どころごとの `kind` と入り方:
  | 入力 | `kind` | 入り方 | 根拠 |
  |---|---|---|---|
  | GUI(公式・M3E)からの送信 | `user`(`rpcId` 付き) | `followup` / `steer` | `$PK/dsh-api-session-controller/lib/index.js:856-860,882-883`、`types/types.d.ts:376-382` |
  | スキルの明示呼び出し | 本文は `user`(スキル本文の `skill-invocation` は cache-sentinel には見えない。下記) | | `$PK/dsh-skill/lib/types/index.d.ts:114-127` |
  | ジョブ完了通知 | `tool-jobs` | アイドルなら `followup`、実行中は `inject` | `$PK/dsh-tool-jobs/lib/index.js:272-295` |
  | リマインダー | `schedule` | `followup` | `$PK/dsh-schedule/lib/index.js:1585-1596` |
  | ゴールの自動継続、`/goal` の作成・編集・再開の後のラウンド | `goal` | `followup` | `$PK/dsh-goal-round-driver/lib/index.js:134-154` |
  | `/goal` の添付 | `user` | `followup`(ゴールのラウンドより先) | 0.2.1-rc.2 の `dsh-command-goal/lib/index.js:98-106` |
  | 親からサブエージェントへの継続 | `agent-message` | | `$PK/dsh-subagent/lib/index.js:1970-1973`、`types/continuation-messages.d.ts:11-18` |
  | サブエージェントから親へのメッセージ | `agent-message` | | 同 `index.js:1857-1864` |
  | サブエージェントの完了通知(親へ) | `subagent-settled` | | 同 `types/continuation-messages.d.ts:19-33` |
  | サブエージェントの最初の課題 | `user` | `queue` | `$PK/dsh-subagent/lib/index.js:1738-1742` |
  | GUI からサブエージェントへの直接の送信 | `user`(`rpcId` 付き) | | 同 `:3017-3021` |
  | 質問への遅い回答 | `user-question-reply` | `steer` | `$PK/dsh-user-questions/lib/index.js:257,582` |
  | webhook(0.2.0-rc.2 のみ。0.2.1-rc.2 にはパッケージが無い) | `webhook` | `followup` | `$PK/dsh-webhook/lib/index.js:184-190` |
  | チームのメッセージ | 0.2.0-rc.2 は `team-message`、0.2.1-rc.2 は `agent-message` | `steer` | `$PK/dsh-experimental-agent-team/lib/index.js:914,926`、0.2.1-rc.2 は同 `:1598-1609` |
- スキル本文(`skill-invocation`)は、dsh-tool-skill の pre-step リスナーが `next()` の後で decision の `messages` に足す
  (0.2.1-rc.2 の `dsh-tool-skill/lib/index.js:896-929`)。最も外側の cache-sentinel が見る `messages` には入らない。
  ユーザーの本文(`user`)で判定が決まるので、結果は変わらない。
- `/goal` に添付があると、`dsh-command-goal` はゴールを作ってから添付を kind `user` の別メッセージとして `followup` する
  (0.2.1-rc.2 の `dsh-command-goal/lib/index.js:98-106,126-144`)。ラウンドの driver は、受信箱の `next-turn` に
  他の入力があるか、エージェントが実行中なら次のラウンドを入れない(`dsh-goal-round-driver/lib/index.js:84-86,249-255`)。
  そのため添付のターンが先に走り、失効していれば止められて添付は破棄される。エージェントが idle に戻ると
  ラウンド(`goal`)が入り(`:223-242`)、こちらは通る。結果として添付なしでゴールが走る。コードを読んだ結果で、実機は未確認。
- 質問への遅い回答は `user-question-reply` の `steer`(0.2.1-rc.2 の `dsh-user-questions/lib/index.js:561-583`)。
  破棄されても質問は回答待ちのまま残る(`:511-514` は予約を解放するだけで、質問が閉じるのは `user/message` を
  受けたとき `:255-262`。`dsh-user-questions/README.md` の Role 節「A discarded reply leaves the question answerable.」)。
- サブエージェントの最初の課題は `user` だが、新しいセッション(`step/end` が無い)なら失効の判定で通る。
  親の履歴を引き継ぐ fork の子は、引き継いだ最後の `step/end` が親の 1 つ前のターンのもので古いことがあるため、
  作成時刻を基準にする(下の「サブエージェントの fork の子の判定材料の調査」R4、#13)。
- `MessageSource` は「`kind` で分岐し、未知の `kind` は素通しする」使い方を想定している(`message.d.ts:121` のコメント)。
  cache-sentinel も `user` だけを見て、それ以外(未知の `kind` を含む)を「ユーザーの送信ではない」とみなす。

## P3: `step/end` はツール結果の後に追加される(2026-10-23, 0.2.1-rc.2)
- `turn()` のループは、pre-step(`$PK/dsh-agent-loop/lib/index.js:956`)→ `step/start`(`:970`)→
  `await this.step(decision)`(`:980`)→ finally で `step/end`(`:992-997`)の順。
- `step()` はモデルの応答を書いた後、同じ呼び出しの中でツールを実行する(`executeToolCalls`、`:1166`)。
  ツールの結果(`tool/result`)は `appendToolResult`(`:691-705`)で書かれ、すべて終わってから `step()` が返る。
  そのため `step/end` の `time` はツールの実行が終わった時刻になる。
- `step/end` から次の pre-step までの間にあるのは、ターンを閉じるときの `agent/turn-stopping`(`:1000-1006`。
  受信箱が空のときだけ)と、pre-step 内の system prompt の組み立て(`:907`)だけ。どちらも通常は時間がかからない。
- ローカルのセッションログ 1 件(2026-10-23 のもの)でも、各ステップの最後の `tool/result` と `step/end` は同じか 1ms 差、
  次の `step/start` はその約 10ms 後だった。
- 結論: 2 ステップ目以降の pre-step では、最終応答時刻(最後の `step/end`)は直前のステップの終わりで、通常は失効していない。
  spec.md §3 の `mid-turn` は、`step/end` の間隔が開いたときの保険にとどまる。長いツール実行の後の続きが
  キャッシュなしで送られても、cache-sentinel は検出しない(spec.md §8)。

## 0.2.1-rc.2 での確認(2026-10-23)
P1・P2 の挙動は 0.2.1-rc.2 でも同じ(`$PK` は 0.2.1-rc.2 の `node_modules/@deepseek-ai`)。行番号は次のとおり。
- ステップの採番: `$PK/dsh-agent-loop/lib/index.js:951-956`(`step = phase.step + 1`)、0 に戻すのは `:865`・`:1040`。
  claim は `:103-111`、runtime context は pre-step の既定の `next()` が足す(`:906-919`)。
- `source.kind`: GUI からの送信 `user` は `$PK/dsh-api-session-controller/lib/index.js:3224-3229`(steer / followup は
  `:949-950`)、ジョブ `tool-jobs` は `$PK/dsh-tool-jobs/lib/index.js:278-295`、リマインダー `schedule` は
  `$PK/dsh-schedule/lib/index.js:1594-1596`、ゴール `goal` は `$PK/dsh-goal-round-driver/lib/index.js:147`、
  サブエージェントは `$PK/dsh-subagent/lib/index.js:446`(`agent-message`)・`:534`(`subagent-settled`)・
  `:1461`(最初の課題 `user`)・`:3196`(GUI からの直接の送信 `user`)。
- 版の差: 0.2.1-rc.2 には `dsh-webhook` パッケージが無い。agent-team のメッセージは `agent-message`
  (`$PK/dsh-experimental-agent-team/lib/index.js:1598-1609`)。どちらも `user` ではないので、分類の結果は変わらない。

---

# サブエージェントの fork の子の判定材料の調査 (2026-10-23, DSH 0.2.1-rc.2) — #13

結論: 子セッションは `session.header` から `origin`('subagent')・`createdAt`・`isSeeded` を読める。
引き継いだ prefix は `session.ownEvents()`(または `snapshotEvents(inheritedEventCount)`)で除ける。
**この API は 0.2.0-rc.2 と 0.2.1-rc.1 にも同じ形である**(下の「版ごとの確認」)。
spec.md §2 の lastResponseAt は、サブエージェントの fork の子に限り `header.createdAt` を基準にする。実機での確認はしていない。

## R1: 子セッションの `header` の読み方 — 確認
- `Session.header` は `SessionHeader`(`$PK/dsh-session/lib/types/index.d.ts:150`、型は `types.d.ts:59-97`)。
- `origin?: 'subagent'`(`types.d.ts:82`)。コメントは「サブエージェントの子として作られたセッションの粗い分類。
  継続可能であることの証明ではない」(presentation metadata)。サブエージェントの子では必ず付く
  (`$PK/dsh-subagent/lib/index.js:346-356` の `childSessionMeta` が `origin: "subagent"` を返す)。
- `createdAt: number`(epoch ms。`types.d.ts:68`)。store が `meta.createdAt ?? Date.now()` で埋める
  (`$PK/dsh-session/lib/index.js:1821`)。子セッションでは親の値を引き継がず、作成時刻が入る。
- `isSeeded: boolean`(fork の prefix を持つか。`types.d.ts:77`)。子セッションの fork / spawn は
  `childSessionMeta` の `isSeeded` = `prepared.seed !== void 0` で決まる(`$PK/dsh-subagent/lib/index.js:346-356,1446`)。
  spawn は `prepareContinuable()` が `{}` を返すので `isSeeded: false`、fork は seed を返すので `true`
  (`$PK/dsh-subagent-spawn-in-process/lib/index.js:31-33`、`$PK/dsh-subagent-fork-in-process/lib/index.js:45-48`)。
- `header` は store が無い場合も最小の header を合成するので**常に存在する**
  (`lib/types/index.d.ts:141-150`)。ただし cache-sentinel は DSH 本体を依存に持たず、偽 Session を食わせる
  テストもあるため、実装では `header?` を任意として扱い、無ければ従来どおりにする(後方互換)。

## R2: 引き継いだ prefix と子自身のイベントの区別 — 確認
- `ownEvents()` は `snapshotEvents(this.inheritedEventCount)`(`$PK/dsh-session/lib/index.js:1465-1467`)。
  型の説明も「Return this Session's events after its fork-inherited prefix」(`lib/types/index.d.ts:224-233`)。
- `inheritedEventCount` は `readonly` で公開されている(`lib/types/index.d.ts:152`)ので、
  `snapshotEvents(inheritedEventCount)` でも同じ列が取れる(`snapshotEvents(fromSeq, toSeqExclusive)`、`:224`)。
- fork では `inheritedEventCount = seed.length`(`$PK/dsh-subagent/lib/index.js:1424`)が
  `agents.create({ seed, inheritedEventCount })` 経由で `Session.create` に届く(`$PK/dsh-agent-loop/lib/index.js:1893-1898`)。
- **deprecated の扱い**: `snapshotEvents()`・`ownEvents()`・`eventAt()` はすべて deprecated で、
  「既存のロジックは未移行のままでよいが、新しい呼び出しは禁止」と書かれている
  (`lib/types/index.d.ts:206-233`。Agent Note `2026-09-09-deprecate-synchronous-session-event-reads.md` を参照)。
  cache-sentinel は既に `snapshotEvents()` を使っており(spec §7)、本件はその**呼び分け**を変えるだけで
  新しい同期読み出しの口を増やさない。移行先の非同期 API は本調査では特定していない(未確認)。よって
  `ownEvents?()` を `SessionLike` に足し、無ければ `snapshotEvents()` にフォールバックする形にする。
  `inheritedEventCount` を読んで自前で切る案は、公開フィールドを 1 つ増やす割に得るものが同じなので採らない。

## R3: 版ごとの確認 (0.2.0-rc.2 / 0.2.1-rc.1)
`npm pack @deepseek-ai/dsh-session@<版>` を ~/AI/tmp/cs-issues/ で展開して型定義を diff した(`$PK` = 展開先 `package`)。

| 項目 | 0.2.0-rc.2 | 0.2.1-rc.1 | 0.2.1-rc.2(現行) |
|---|---|---|---|
| `Session.header` | あり `lib/types/index.d.ts:119` | あり `:150` | あり `:150` |
| `SessionHeader.createdAt` | あり `lib/types/types.d.ts:67` | あり `:68` | あり `:68` |
| `SessionHeader.origin?: 'subagent'` | あり `lib/types/types.d.ts:81` | あり `:82` | あり `:82` |
| `SessionHeader.isSeeded` | あり `lib/types/types.d.ts:76` | あり `:77` | あり `:77` |
| `Session.ownEvents()` | あり `lib/types/index.d.ts:200`(deprecated) | あり `:231`(deprecated) | あり `:231`(deprecated) |
| `Session.inheritedEventCount` | あり `lib/types/index.d.ts:121` | あり `:152` | あり `:152` |
| `ownEvents()` の実装 | `snapshotEvents(this.inheritedEventCount)` `lib/index.js:1389-1390` | 同 `:1465`(rc.2 と同一) | 同 `:1465` |

対応範囲(0.2.0-rc.2〜0.2.1-rc.1)の全版で同じ API があるため、**版による分岐は書かない**。

## R4: 子の最初のステップが止まる経路 — 確認(#13 の再現)
- fork の seed は「最後の `turn/end` まで」に切られる(`$PK/dsh-subagent-fork-in-process/lib/index.js:22-27`)。
  fork は親のツール実行中(= 親のターンが未完了)に起きるので、seed に入る最後の `step/end` は
  **1 つ前のターンの最後のステップ**のもの。`step/end` はツール実行の後に書かれる
  (P3。`$PK/dsh-agent-loop/lib/index.js:980,992-997,1166`)ので、fork が起きたターンの応答は seed に入らない。
- 子の最初の課題は `source: { kind: "user" }` で queue され(`$PK/dsh-subagent/lib/index.js:1460-1463`)、
  最初のステップは `step === 1`(`$PK/dsh-agent-loop/lib/index.js:951-956`)。よって `classifyStep` は `user-send`。
- そのため引き継いだ古い `step/end` で失効と判定され、拒否される。`/unlock` は親の id にしか付かない。
- 子の `createdAt` 基準にすれば、fork は親のモデル呼び出し直後(ツール実行中)なのでキャッシュは温かく、
  判定の意味とも一致する。GUI などで古いセッションを fork した場合(`origin` 無し)は従来どおりにする。

---

# プロファイル名の取得 (2026-10-23) — #9 の state.json のプロファイル別分離の根拠

`$PK` = `<DSH のインストール先>/node_modules/@deepseek-ai`(0.2.1-rc.2)。CLI 本体の `lib/` は `$PK/../../lib/`
(`@deepseek-ai/dsh/lib/`)。旧版は `npm pack @deepseek-ai/<pkg>@<版>` で `~/AI/tmp/cs-issues/` に展開して読んだ
(Z2 の表のパスはここからの相対)。実機の起動はしていない(型定義と実装の読解のみ)。コードからの推論である旨は各項に記す。

## Z1: `ctx.get('profileContext')` でプロファイル名が取れる — 確定

- 型: `$PK/dsh-app-boot/lib/types/profile-context.d.ts` の `ProfileContext` は
  `readonly name: string` を持ち(interface は `:10-25`)、`declare module '@deepseek-ai/cordis'` で
  `Context.profileContext` を宣言する(`:26-31`)。
  doc は「Present only in a profile launched by dsh.」— つまり**無い環境がありうる**ので、
  `ctx.get` は `undefined` を返しうる前提で扱う。
- provide の実装: `$PK/../../lib/profile-boot-C14i-8IN.js`。`:290` で
  `const profileContext = { name: options.profile, dir: …, home: resolveDshHome(), … }` を組み立て、
  `boot()` のコールバックで `hostCtx.provide("profileContext", profileContext)` を呼び(`:304`)、
  その後にプラグインを読み込む(`:306` の `hostCtx.plugin(PluginPackages, …)`)。
  プラグインの `apply` より前に provide されるため、`apply()` の時点で読める。
- 消費例(公式、いずれも `ctx.get("profileContext")` が `undefined` の場合を扱う):
  - `$PK/dsh-shell-env/lib/index.js:90-94`(`profile.name` と `profile.dir` をシェル環境に載せる)
  - `$PK/dsh-app-boot/lib/index.js:2313`(`preflight`。`if (profile === void 0) return …`)と
    `:2399`(`prepareProfilePatches`。`if (ctx.get("profileContext") === void 0) return patches`)
- **`inject` に足す必要は無い。** `inject` に無いサービスを `ctx.get` で読むのは公式プラグインと同じ使い方で、
  inject に足すと `profileContext` を provide しないホスト(テスト・別アプリ)でプラグインが `PENDING` のまま起動しなくなる。
  そのため `HostContext` に `get?` を足し、`ctx.get?.('profileContext')?.name` と optional に読む。
- **未確認:** `web` プロファイルの実機で `ctx.get('profileContext')` が解決すること。型・provide の実装・
  公式プラグインの消費例の 3 点から確実と見ているが、実機確認はしていない(タスク指示により実機確認は行わない)。
  解決しなかった場合は「プロファイル名なし」の経路に落ちて従来どおり共有ファイルを使うだけで、壊れない。

## Z2: 同じ口が 0.2.0-rc.2・0.2.1-rc.1 にもある — 確定

対応範囲(`docs/spec.md`・README の「0.2.0-rc.2〜0.2.1-rc.1」)の両端で確認した。

| 版 | 型 `profile-context.d.ts` | provide の実装 |
|---|---|---|
| 0.2.0-rc.2 | `pack-020/ab020/package/lib/types/profile-context.d.ts` | `cs9/cli-020/package/lib/profile-boot-BZ2ZjNWi.js:259-273`(`name: options.profile`、`:273` で provide) |
| 0.2.1-rc.1 | `cs9/appboot-0.2.1-rc.1/lib/types/profile-context.d.ts`(rc.2 と diff なし) | `cs9/cli-rc1/package/lib/profile-boot-C14i-8IN.js:290-304`(rc.2 のファイルと diff なし) |
| 0.2.1-rc.2(手元) | `$PK/dsh-app-boot/lib/types/profile-context.d.ts` | `$PK/../../lib/profile-boot-C14i-8IN.js:290-304` |

- 型定義は 0.2.0-rc.2 と 0.2.1-rc.1 で `readBundlePatches` の宣言が増えただけ(`name` は両方にある)。
- `profile-boot` は 0.2.1-rc.1 と 0.2.1-rc.2 で完全一致、0.2.0-rc.2 とは `initializeProfileFromDefault` の
  実装だけが違い、`profileContext` の組み立てと provide は同じ。
- `dsh-shell-env` の消費側も 0.2.1-rc.1 に同じ行がある(`cs9/shell-env-0.2.1-rc.1/lib/index.js:90`)。
- **未確認:** 0.2.1-alpha.1〜alpha.5 の `dsh-app-boot`。README の対応範囲には含まれるが、
  `profileContext` は 0.2.0-rc.2 から存在するので alpha 系でも同じと見ている(差分は未取得)。

## Z3: プロファイル名の規則と state.json の置き場所 — 確定(Windows は推測)

- `dsh-app-boot` の `resolveProfileDir` は、`""`、`/` か `\` を含む名前、`.`、`..`、`node_modules` を
  `dsh: invalid profile name` として throw し、それ以外は `join(home, 'profiles', name)` を返す
  (`$PK/dsh-app-boot/lib/index.js:546-549`、検査は `:547`、`PROFILES_DIR = "profiles"` は `:507`)。
  同じ検査が 0.2.1-rc.1(`cs9/appboot-0.2.1-rc.1/lib/index.js:547`)と 0.2.0-rc.2
  (`pack-020/ab020/package/lib/index.js:525`)にもある。
- npm 版 CLI の起動では、provide する名前はこの検査を通っている: `$PK/../../lib/profile-boot-C14i-8IN.js:272` の
  `composeProfile(options.profile, …)` → `:237` の `prepareProfile` → `:218` の `loadProfile` →
  `$PK/dsh-app-boot/lib/index.js:1066` の `resolveProfileDir(name, home)`。`:290-291` の `name: options.profile` は同じ値。
  ただし `:237` はアプリが渡す `resolvedProfile`(「application-owned profile」、`:233`)があると `prepareProfile` を
  呼ばない。この経路を使うアプリ(Desktop など)が名前を検査するかは確認していない。
- そのため cache-sentinel は、`profileNameOf` で同じ規則を検査し、外れた名前は「プロファイル名なし」として従来の
  共有ファイルに落とす(念のための検査)。規則に合う名前は変換しない。変換すると `a b` と `a_b` のような
  別プロファイルが同じファイルを共有し、#9 と同じ競合を新たに作るため。
- 置き場所は `$DSH_HOME/cache-sentinel/profiles/<名前>/state.json`。`cache-sentinel/<名前>/` だと従来の
  `cache-sentinel/state.json` や一時ファイル `state.json.<unique>.tmp`(`src/state.ts` の `tempPathFor`)と同じ階層になり、
  DSH が受け付ける名前 `state.json` のプロファイルでは保存先のディレクトリを作れない。`profiles/` の下に置けば
  名前空間が分かれる(DSH 自身の `profiles/<名前>` と同じ形)。
- Windows で使えない文字(`:` `*` `?` `<` `>` `|` など)と予約名(`CON` など)は DSH も検査しない。
  その名前では DSH の `profiles/<名前>` の作成が先に失敗し、プロファイルとして起動しないはずなので、
  cache-sentinel でも検査しない(推測。Windows 実機は未確認)。

## Z4: 複数プロファイルの同時利用 — DSH 側の共有状態

- `$DSH_HOME` はプロファイルに依存しない(`$PK/dsh-home-paths/lib/index.js:109-111` の `resolveDshHome`。
  引数にプロファイル名は入らない)。`dsh-base/cordis.patch.yml:141,185` の `dshHomePath('sessions')` /
  `dshHomePath('storages')` も同じホームを指す。
- **アーカイブ状態(`$DSH_HOME/storages/workspace.json`)は全プロファイルで共有され、cache-sentinel から分離できない。**
  `WorkspaceRegistry` は起動時に `domain.global.get()` をメモリに持ち(`$PK/dsh-workspace/lib/index.js:383-384`)、
  書き込みは「メモリ上の global 全体 + 自分の変更」でファイル全体を置き換える(`:938-941`)。
  `storage-json` の single レイアウトはファイル全体を atomic に置き換える
  (`$PK/dsh-storage-json/lib/types/atomic.d.ts:1-11`)。プロセス間の直列化は無いので**ロスト更新**になる。
- この部分は cache-sentinel では防げない。README の Limitations に書いて利用者に委ねるのが #9 で選んだ方針。

---

# 入力欄から引数つきコマンドを実行する条件の調査 (2026-10-23, DSH 0.2.1-rc.2) — #36

`$PK` = 0.2.1-rc.2 の `node_modules/@deepseek-ai`。0.2.0-rc.2 は `npm pack` で
`~/AI/tmp/cs-issues/pack020/` に展開したもの(以下 `$OLD`)。**0.2.0-rc.2 と 0.2.1-rc.2 で結論は同じ**。

## Y1: `CommandInputDescriptor` の形 — 確定(両版で同一)
- `{ hint: string; attachments?: boolean }`。`hint` は必須、`attachments` は省略可
  (`$PK/dsh-commands/lib/types/types.d.ts:20-31`、`$OLD/commands/package/lib/types/types.d.ts:20-31`)。
  `attachments` を省く(または false)と、添付つきの実行はコマンド実行前に拒否される(同 `:26-30`)。
  cache-sentinel の `/sentinel` は添付を使わないので **`hint` だけを渡す**。
- `CommandDescriptor.input?: CommandInputDescriptor`(同 `:63`)と
  `CommandDefinition.input?: CommandInputDescriptor`
  (`$PK/dsh-commands/lib/types/index.d.ts:46`、`$OLD/commands/package/lib/types/index.d.ts:40`)。
  `ctx.commands.register(definition)` はこの `CommandDefinition` を取る(`index.d.ts:94`)。

## Y2: 引数つきの入力がコマンドとして実行される条件 — 確定
公式 UI は `/` で始まる行を Enter の時点で判定し、コマンドの登録に `input` があるときだけ
「引数つき 1 行」を claim(引数を受け取る形)として実行する。`input` が無いと **引数つきの行はコマンドにならず、
普通のメッセージとしてモデルへ送られる**。判定は次の 2 か所。

1. `matchEnter`(`$PK/dsh-client-ui-commands/lib/client.js:1624-1673`、`$OLD/ui-commands/package/lib/client.js:975-1024`)。
   行を最初の空白で `token`(例 `/sentinel`)と残り(`archive`)に分け、登録を引く。登録が見つかっても
   `desc.input === undefined` なら `if (!bare) return void 0` で「コマンドでない」を返す
   (rc.2 `:1665`、0.2.0-rc.2 `:1016`)。`input` があれば
   `return { claim: this.leadingClaim(desc, session, token.slice(1)) }`(rc.2 `:1661-1663`、
   0.2.0-rc.2 `:1012-1014`)で claim を返す。claim の `token` は `` `/${shown} ` ``(末尾に空白)、
   `submit(args, ...)` は `` `/${desc.name} ` + args `` を `remote.commands.execute` に渡す
   (`leadingClaim` は rc.2 `:1695-1705`、0.2.0-rc.2 `:1046-1056`)。
   Space キーと claim の復元で使う `claimOf`(rc.2 `:1601-1607`)も、`input` が無ければ claim を返さない。
2. 受け側 `SubmitMachine.onAdjudicated`(`$PK/dsh-client-ui-conversation/lib/client.js:5193-5211`、
   `$OLD/ui-conv/package/lib/client.js:3925-3943`)。`matchEnter` の戻りが `undefined` のとき(= コマンドでない)だけ
   `detachedEffects` に落ちて普通の送信になる(rc.2 `:5206-5210`、0.2.0-rc.2 `:3938-3942`)。
   claim なら `args = argsAfter(draft, claim.token)`(rc.2 `:5203`、`argsAfter` は `:5064-5073`)を
   引数として submit する。`argsAfter` は claim の `token`(末尾に空白)で始まる行からその後ろを取る。

- つまり `/sentinel` に `input` を渡すだけで、`/sentinel archive` は claim 経由のコマンド実行になり、
  handler の `rawInput` に `" archive"`(区切りの空白を含む)が届く。`parseSentinelArgs` は trim するのでそのまま使える。
- `recordInput` は既定 true(`$PK/dsh-commands/lib/types/index.d.ts:48-53`)。`/sentinel` は従来どおり
  `command/run` に `rawInput` が記録されてよいので渡さない。

`input` を付けると、入力欄での見え方も次のように変わる(コードで確認。実機では未確認)。
- `hint` は補完の候補ではなく、入力欄のプレースホルダになる。claim 中で `/sentinel ` の後ろが空のあいだだけ
  `hint` を表示する(`$PK/dsh-client-ui-conversation/lib/client.js:18963-18971`、0.2.0-rc.2 は
  `$OLD/ui-conv/package/lib/client.js:17418`)。型の doc も "Placeholder shown before the user supplies
  free-form input"(`types.d.ts:21`)。`hint.<コマンド名>` の翻訳が無いので、登録した文字列がそのまま出る(`:18968-18970`)。
- メニューから選ぶと、その場では実行されず claim(引数の入力待ち)になる(`dispatch`、rc.2 `:1578`)。
  `input` が無いコマンドはその場で実行される(rc.2 `:1579-1584`)。
- 行の途中で打った `/` のメニューから外れる。候補一覧は `hint` のある行を、`position` が `"leading"` のときだけ残す
  (`candidates`、rc.2 `:1541`・`:1554`、0.2.0-rc.2 `:906`・`:919`)。`position` は `/` が行の最初の空白以外の文字なら
  `"leading"`、そうでなければ `"inline"`(`$PK/dsh-client-ui-input-trigger/lib/client.js:803`)。
  `/sentinel` を文中に挿す使い方は想定しないので、影響は小さい。
- `/unlock` は引数を取らない。`input` が無いコマンドは bare な入力で `runDetached` に落ちて実行される
  (rc.2 `:1666-1671`)ので現状のままで入力欄から使える。`input` を足すと、メニューで選んだ後にもう一度 Enter が要り、
  行の途中の `/` メニューにも出なくなるだけで得るものが無い。**変更しない。**
