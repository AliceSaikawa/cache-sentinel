# T0 spike 結果 (2026-10-15, DSH 0.2.0-rc.2)

調査対象: `/home/user/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`(以下 `$PK`)。
コードは書いていない。実機動作は T9 で確認する(ここは型定義・実装読解と実ファイル確認まで)。

## U1: Host プラグインの形と inject するサービス — 確定
- 形: `export const name`, `export const inject = [...]`, `export function apply(ctx, config)`、
  設定は `export const Config = z.object({...})`(`import z from '@deepseek-ai/schemastery'`)。
  根拠: `$PK/dsh-hooks-claude-code/lib/index.js:2,114-121,405`、既存例 `/home/user/dev/dsh-webui-m3e/src/host/index.ts:21-22,110`。
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

`$PK` = `/home/user/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`

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
