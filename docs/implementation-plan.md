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
- 観察2: 差し替え後の新コード(0.1.1)は**再起動するまで反映されない**。patch の config 変更だけは反映される。
- 観察3: `ctx.logger.info` は journal(`journalctl --user -u deepseek-harness`)に出ない。warn は出る見込み。
  そのため dryRun 中は info を warn で出す(0.1.1)。
- プロファイルの `cordis.patch.yml` 末尾に検証用設定(dryRun / idleMinutes 1 / archiveExisting)を追記済み。**検証後に削除すること。**
- 検証手順は README を参照(再起動 → journal で dryRun ログ確認 → dryRun 解除)。
