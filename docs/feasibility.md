# 実現可能性調査 (2026-10-15)

## 結論
DSH の Host プラグインとして実現可能。対象は DSH のみ(Claude Code 版は対象外)。

## 根拠
| 必要なもの | DSH の提供物 |
|---|---|
| 最終更新時刻 | セッションログの各イベントが `time` (epoch ms) を持つ。`Session.ownEvents()` の末尾で取得可能 |
| 定期チェック | `cordis-plugin-timer` / `ctx.setInterval` |
| アーカイブ | `ctx.workspaceRegistry.archiveSession(id, { stopActivity })` |
| 送信の防止 | GUI ではアーカイブ済みセッションを開けない(2026-10-15 ユーザー確認)。加えて `ArchivedSessionGate` (dsh-api-session-controller) が `agent/pre-step` で アーカイブ済みセッションのステップを `blocked` にする。unarchive で解除 |
| 実行中の扱い | 実行中ターン・ジョブ・サブエージェントがあると既定で `workspace/session-activity` が拒否する。実行中は対象外にするのが安全 |

## 設計メモ
- アーカイブ = サイドバーから非表示 + 新規ステップ実行のブロック。履歴は保持され、unarchive で復帰。
- 最後の更新が閾値超過、かつ実行中の作業がないセッションのみ対象(`stopActivity` は使わない)。
- 閾値(分)・チェック間隔・ピン留めセッションの除外・サブエージェント除外は設定可能にする。
- 未確認事項: 起動時に未ロードの永続セッションの最終イベント時刻をどう安価に取るか(ログ末尾読み / ファイル mtime)。

## 注意
- アーカイブ解除後の最初の送信は、結局通常インプット料金になる(キャッシュは戻らない)。本プラグインは「うっかり送信」を防ぐガード。
- Claude Code にはアーカイブ API が無く、UserPromptSubmit フックでのブロックのみ可能なため対象外とした。
