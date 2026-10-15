# cache-sentinel

DSH (DeepSeek Harness) 用 Host プラグイン。最後のセッション更新から一定時間(既定 1 時間)を超えたセッションを自動でアーカイブし、
キャッシュ失効後に誤って再開して通常のインプット料金が発生することを防ぐ。

状態: 仕様 v0.2 / spike 完了 / 実装前。[spec](docs/spec.md) / [spike](docs/spike.md) / [実装計画](docs/implementation-plan.md) / [実現可能性](docs/feasibility.md)。
