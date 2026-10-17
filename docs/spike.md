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
行番号は特記なければ rc.1 のもの。DSH の実機起動はしていない(0.2.0-rc.2 の実機確認は上記の各節で実施済み)。
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
| 5 `connection.fetch.register` | 変更なし | 型は同じ(信頼判定の変更のみ) | 同左 | 型は同じ。owner 以外の Peer に exact route が 403 |
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
6. ログ配置: `$PK/dsh-session-persistence-jsonl/lib/index.js:745-965` は rc.2 と同一。`encodeSegment`
   (`:858`)は `~XXXX`、ファイル名は `session.v4.jsonl[.zstd]`、`SESSION_FORMAT_VERSION` は 4。
   root は dsh-base の `dshHomePath('sessions')`。
7. クライアント: `dsh.client` の解析は `$PK/dsh-client-modules/lib/index.js:66-74,733-745`、inject の
   先行読み込みは `client.js:789`。`conversation.input.dock` は
   `$PK/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:295`。
8. バンドル: `headless` = dsh-base + dsh-headless、`web` = dsh-base + dsh-web-app。dsh-base は
   `timer`・`sessions`・`sessionPersistence`・`commands` を提供。`workspaceRegistry` と `connection` は
   dsh-web-app だけ。そのため headless では cache-sentinel は起動しない(全版共通)。

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
