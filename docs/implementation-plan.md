# 実装計画 (実装担当: OpenCode + deepseek-v4.1-flash / レビュー: Claude)

軽量モデルに任せるため、タスクを小さく切り、純粋関数を先に作る。DSH 依存部分は最後に薄く繋ぐ。
各タスクは 1 コミット。テストは `node --test`(Node 組込み、依存追加なし)。

| # | タスク | 成果物 | 受入 |
|---|---|---|---|
| T0 | spike: U1〜U5 を調べ `docs/spike.md` にまとめる(コードは書かない) | spike.md | 各項目に根拠(ファイル/行)つき |
| T1 | scaffold: package.json(type: module)、tsconfig、`src/` `tests/` | 雛形 | `pnpm test` が空で通る |
| T2 | `src/config.ts`: 既定値と検証(§6) | 純粋関数+テスト | 不正値は例外 |
| T3 | `src/decide.ts`: 入力(セッション情報, config, now, baselineAt, unarchivedAt)→ archive 対象 id 配列。§3 の 1〜5 と §8 | 純粋関数+テスト | A1〜A4, A5, 時計巻き戻り |
| T4 | `src/state.ts`: state.json の読み書き・破損復旧・掃除(§7) | テスト(tmp dir) | A7 |
| T5 | `src/diff-unarchive.ts`: archived 集合の差分検出(§5) | 純粋関数+テスト | 初回は記録のみ |
| T6 | `src/cycle.ts`: 1 サイクル(依存を引数注入)。maxPerCycle, dryRun, 例外隔離 | テスト(モック) | A6, A8, 実行中スキップ |
| T7 | `src/index.ts`: Host プラグイン本体。inject、interval、ログ、dispose | 実機 | spike の結果に従う |
| T8 | `cordis.patch.yml` と README の導入手順 | docs | dsh 上で有効化できる |
| T9 | 実機検証: テスト用セッションで idleMinutes=1 を設定し A1/A5 を確認 | 検証メモ | 目視+ログ |

## 運用ルール
- 実装者は `AGENTS.md` を守る。範囲外のファイルを触らない。1 タスク 1 コミット。
- T0 と T7/T9 は難所なので、レビューを厚くする(Claude が差分を確認)。T2〜T6 は仕様が固いので任せやすい。
- 完了条件は「テスト緑 + 受入列を満たす」。テストを弱めて通すのは禁止。
