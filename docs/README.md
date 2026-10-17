# docs 目次

利用者向けの導入・使い方はリポジトリ直下の [README.md](../README.md) を参照してください。
このディレクトリには、開発者向けの設計仕様書と開発時の記録を置いています。

## 設計仕様書

- [spec.md](spec.md): 全体仕様(v0.4 モード切り替え・v0.3 入力禁止の仕様と受入基準)
- [spec-ui.md](spec-ui.md): UI 対応仕様(v0.5 ブロック時の会話表示・送信前バナー・ステータス取得 API・表示言語)
- [archive-spec.md](archive-spec.md): アーカイブモード仕様(v0.2 自動アーカイブの判定・手動解除の猶予・永続状態)

## 開発時の記録

- [spike.md](spike.md): DSH 本体の型定義・API・イベント仕様の調査記録
- [rdsh-check.md](rdsh-check.md): rustdsh 環境(Desktop・同梱プラグイン)での動作確認記録(Issue #16、2026-10-17)
- [feasibility.md](feasibility.md): 初期の実現可能性調査メモ
- [implementation-plan.md](implementation-plan.md): タスク分割と各バージョンの実装・実機検証記録
