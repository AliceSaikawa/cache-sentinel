# cache-sentinel

DSH (DeepSeek Harness) 用 Host プラグイン。最後のセッション更新から一定時間(既定 1 時間)を超えたセッションを自動でアーカイブし、
キャッシュ失効後に誤って再開して通常のインプット料金が発生することを防ぐ。

状態: 実現可能性の調査完了 / 実装前。詳細は [docs/feasibility.md](docs/feasibility.md)。
