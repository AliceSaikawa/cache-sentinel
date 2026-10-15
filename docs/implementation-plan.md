# 実装計画 (実装担当: OpenCode + deepseek-v4.1-flash / レビュー: Claude)

軽量モデルに任せるため、タスクを小さく切り、純粋関数を先に作る。DSH 依存部分は最後に薄く繋ぐ。
各タスクは 1 コミット。テストは `node --test`(Node 組込み、依存追加なし)。

| # | タスク | 成果物 | 受入 |
|---|---|---|---|
| T0 | spike: U1〜U5 の調査 — **完了**(Claude) | [spike.md](spike.md) | 各項目に根拠つき |
| T1 | scaffold: package.json(type: module)、tsconfig、`src/` `tests/` | 雛形 | `pnpm test` が空で通る |
| T2 | `src/config.ts`: 既定値と検証(§6) | 純粋関数+テスト | 不正値は例外 |
| T3 | `src/decide.ts`: 入力(セッション情報, config, now, baselineAt, unarchivedAt)→ archive 対象 id 配列。§3 の 1〜5 と §8 | 純粋関数+テスト | A1〜A4, A5, 時計巻き戻り |
| T4 | `src/state.ts`: state.json の読み書き・破損復旧・掃除(§7) | テスト(tmp dir) | A7 |
| T5 | `src/diff-unarchive.ts`: archived 集合の差分検出(§5) | 純粋関数+テスト | 初回は記録のみ |
| T6 | `src/cycle.ts`: 1 サイクル(依存を引数注入)。maxPerCycle, dryRun, 例外隔離 | テスト(モック) | A6, A8, 実行中スキップ |
| T7 | `src/index.ts`: Host プラグイン本体。inject は `workspaceRegistry, sessionPersistence, sessions, timer`、`src/services.d.ts`、mtime インデックス(spike U2) | ビルド可能な `lib/index.js` | spike.md に従う。V1 を確認 |
| T8 | `cordis.patch.yml` と README の導入手順 | docs | dsh 上で有効化できる |
| T9 | 実機検証: テスト用セッションで idleMinutes=1 を設定し A1/A5 を確認 | 検証メモ | 目視+ログ |

## 運用ルール
- 実装者は `AGENTS.md` を守る。範囲外のファイルを触らない。1 タスク 1 コミット。
- T7/T9 は難所なので、レビューを厚くする(Claude が差分を確認)。T2〜T6 は仕様が固いので任せやすい。
- 完了条件は「テスト緑 + 受入列を満たす」。テストを弱めて通すのは禁止。

## OpenCode の実行方法 (確認済み 2026-10-15)
- バイナリ: `/home/user/.opencode/bin/opencode` (v2.0.26)。**PATH には入っていない**ので絶対パスで呼ぶ。
- 無料モデル: `opencode/deepseek-v4.1-flash-free`(`opencode models` で確認)。`opencode/deepseek-v4.1-flash` は無料版ではない可能性があるので使わない。
- 起動には `~/.local/share/opencode/log` への書き込みが必要。DSH の workspace-write サンドボックスでは `EROFS` で失敗するため、
  Claude から呼ぶときは権限昇格の承認が要る。ユーザーが自分の端末から実行してもよい。
- 1 タスクの実行例(リポジトリ直下で):
  ```sh
  /home/user/.opencode/bin/opencode run --standalone -m opencode/deepseek-v4.1-flash-free \
    --title "T2 config" "AGENTS.md と docs/spec.md §6、docs/implementation-plan.md の T2 を読み、T2 だけを実装してコミットせずに止まること"
  ```
- `--auto` は deny されない権限を自動承認する。`~/.config/opencode/opencode.jsonc` の deny ルール(rm -rf、git push --force 等)は効くが、
  初回は付けずに挙動を見る。コミットは Claude の差分レビュー後に行う運用にする。

## T9 実機検証の記録 (2026-10-15)
- 導入: `dsh plugin --profile web add file:.../cache-sentinel-0.1.1.tgz`。プロファイルのバックアップは
  `~/.dsh/profiles/web/{package.json,pnpm-lock.yaml,cordis.patch.yml}.bak-before-20261015-cache-sentinel`。
- 観察1: `patchReload: live` で、導入直後に **Host 側がライブで読み込まれた**(`~/.dsh/cache-sentinel/state.json` が作られた)。
- 観察2: 差し替え後の新コード(0.1.1)は**再起動するまで反映されない**。patch の config 変更がライブで反映されるかは**未確認**。
- 観察3: 20:13:39 の再起動後、0.1.1 は 20:21:30 に起動したが(state.json の mtime)、**warn も含め journal に何も出なかった**。
  `ctx.logger` は exporter(`plugin-logger-console`)がないと捨てられ、DSH には同梱されていない(`cordis/README.md`)。
  他プラグイン(`[claude-oauth]` 等)は console に直接書いている。→ 0.1.2 で `[cache-sentinel]` 付きで console にも出す(`src/log.ts`)。
- 観察4: 20:21:13 にプロセスが失敗メッセージなしで終了し(=終了コード 0 と推定)、systemd が自動再起動した。原因は未特定。
  プラグイン由来の例外ならスタックトレースが残るはずなので、可能性は低いと見ている。
- プロファイルの `cordis.patch.yml` 末尾に検証用設定(dryRun / idleMinutes 1 / archiveExisting)を追記済み。**検証後に削除すること。**
- 検証手順は README を参照(再起動 → journal で dryRun ログ確認 → dryRun 解除)。
- 観察5 (20:28 再起動後, 0.1.2, dryRun / idleMinutes 1 / archiveExisting true / maxPerCycle 20):
  - journal に `[cache-sentinel] 開始 ...` と `dryRun: アーカイブ対象 ...` が出た。ログ出力は解決。
  - トップレベル 27 件のうち、アイドル最長の 20 件が毎サイクル同じ順で選ばれた(maxPerCycle の上限どおり)。
  - アーカイブ済み(`c5e54134`)とピン留め(`30dd7b39` = この検証セッション)は対象外。サブエージェント(`<uuid>` 形式の id、120 件)も対象外。
  - トップレベルの id は `session-<uuid>`、ログディレクトリ名も同じで、mtime インデックスは一致した(V1 を実データで確認)。
- 未検証: dryRun を外した実アーカイブ、GUI への反映、手動解除後の猶予(A5)、patch の config 変更がライブで反映されるか。
- 観察6 (20:31, dryRun 解除 / idleMinutes 2 / archiveExisting false / 間隔 30 秒):
  - **patch の config 変更はライブで反映された**(同じ PID のままプラグインが新しい設定で再適用。古いインスタンスの interval は停止)。
  - 基準時刻以降に更新された未ピン留めの 2 件(`105db5e8`, `a9cd3ef3`)をアーカイブ(A1)。どちらも再起動後に GUI が自動作成した
    メッセージなしの空セッションで、GUI の一覧には出ない。
- 観察7 (A5, `scripts/dsh-rpc.mjs` で RPC を直接呼んで検証):
  - 20:38:08 `c5e54134`(dev/、10/5 から放置、元からアーカイブ済み)を `workspace/unarchiveSession` で解除。
  - 20:38:30 「手動解除を検出しました」→ state.json に unarchivedAt(検出時刻)を記録。
  - 20:40:20 時点で未アーカイブ(猶予中)。20:41:00 に再アーカイブ。元の状態に戻った。
- 20:41:34 検証用設定を削除し、既定値(60 分 / 60 秒)で稼働中。
- 確認済み(ユーザー, 21:26): DSH の GUI ではアーカイブ済みセッションを開けない。閲覧も不可なので、誤送信は起こらない。
  「閲覧のみ」(見られるが送れない)は DSH のアーカイブでは実現できない。必要なら別方式(下記)を検討する。
- 将来の選択肢: アーカイブせず、Host 側で `agent/pre-step` を使って「1 時間超のセッションへのステップ」を拒否すれば閲覧のみにできる。
  ただしブロック時の確認・上書き手段の UI が必要になり、規模が大きい。


---

# 閲覧のみ方式 (spec v0.3) の実装計画 — 2026-10-15

アーカイブ方式は停止済み(profile で `disabled: true`)。同じリポジトリで作り直す。版は 0.3.0。

| # | タスク | 担当 | 成果物 |
|---|---|---|---|
| T10 | 旧方式のコード削除(decide/state/diff-unarchive/activity/cycle とテスト) | Claude | 削除 |
| T11 | `src/config.ts` を spec §6 のキーに置き換え | flash | config.ts + テスト |
| T12 | `src/gate.ts`: `decideGate`(spec §3, §4 の判定) | flash | 純粋関数 + テスト |
| T13 | `src/last-response.ts`: イベント列から最終応答時刻、セッション別キャッシュ | flash | + テスト |
| T14 | `src/unlock.ts`: 許可の記録と `/unlock` の応答文(spec §4) | flash | + テスト |
| T15 | `src/index.ts`: pre-step(prepend)・session/event・commands の接続 | Claude | + テスト(flash) |
| T16 | 実機検証(B1〜B9、GUI でのブロック表示) | Claude + ユーザー | 記録 |

## T16 実機検証の記録

- **事故 (21:43)**: 0.3.0 を `dsh plugin add` で入れた後、無効化していたエントリを再起動なしで有効化(`idleMinutes: 3`)したところ、
  プロセス内にキャッシュされていた**旧版 0.1.2(アーカイブ方式)が読み込まれ**、21:43:53 に 2 件をアーカイブした。
  - 対象: `session-719b8090…`(~/dev)、`session-adb67e74…`(~/dev/agnostic-tokenizer)。どちらも 21:30 作成の空セッション(ターン 0)。
  - 21:44 にエントリを再び無効化し、2 件を `workspace/unarchiveSession` で解除。アーカイブ集合は事故前(3 件)に戻した。
  - 教訓: **パッケージの新しいコードは DSH の再起動でしか読み込まれない**。無効→有効の切り替えでも古いモジュールが再利用される。
    新しい版を入れたら、有効化の前に必ず再起動する。
- 現状: 0.3.0 は導入済み・エントリは `disabled: true`。再起動後に有効化して検証する。
