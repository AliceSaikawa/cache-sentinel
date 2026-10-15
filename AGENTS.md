# cache-sentinel 作業指示

- 仕様は `docs/spec.md`、タスクは `docs/implementation-plan.md` が正。仕様と食い違う場合は実装せず質問する。
- TypeScript (ESM)。ランタイム依存は追加しない。開発依存の追加は事前確認。
- 純粋関数と副作用を分ける。DSH の API 呼び出しは `src/index.ts` と `src/cycle.ts` の注入点に限定する。
- テストは `node --test`。仕様変更なしに期待値を変えない。
- 1 タスク 1 コミット、日本語の短いメッセージ。push しない。
- DSH 本体(`/home/user/.local/lib/node_modules/@deepseek-ai/dsh/`)は読み取り専用。変更しない。
- 憶測で DSH の API を書かない。型定義(`lib/types/*.d.ts`)か README で確認し、根拠を `docs/spike.md` に残す。
