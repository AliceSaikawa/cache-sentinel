# cache-sentinel

DSH (DeepSeek Harness) 用 Host プラグイン。最後のモデル応答から一定時間(既定 60 分)が過ぎたセッションでは、
**モデル / API への送信をすべて止める**(閲覧のみ)。プロンプトキャッシュが切れた後の誤送信で、
履歴全体が通常のインプット料金で送られるのを防ぐ。承知のうえで送るときは `/unlock` を使う。

状態: 0.3.0(閲覧のみ方式)実装・実機検証済み。仕様は [docs/spec.md](docs/spec.md)、調査は [docs/spike.md](docs/spike.md)。
旧アーカイブ方式は廃止([docs/legacy/archive-spec.md](docs/legacy/archive-spec.md))。

## 動作
- セッションは開けて読める。止まるのはモデルを呼ぶステップだけ。
- 止める対象はメッセージの出どころを問わない: 自分の送信、リマインダー、ゴールの自動継続、ジョブ完了通知、サブエージェント、
  長いツール実行の後のステップ。自動圧縮より先に判定するので、圧縮のリクエストも出ない。
- 止まったときはリクエストが出ず、料金はかからない。**送った文面は破棄される**ので、解除後に入力し直す。
- 経過時間は「最後のモデル応答(`step/end`)から」で測る。新規セッション(応答がまだない)は止めない。

## `/unlock`
- 止まったセッションで `/unlock` を実行すると、次の送信を 1 回だけ通す。許可は 10 分で切れる。
- 応答が 1 回返れば許可は役目を終え、その後は通常どおり(60 分以内なら止まらない)。
- 失効していないセッションで実行すると、経過時間を表示するだけで何もしない。

## 導入
```sh
pnpm install && pnpm test && pnpm run build && pnpm pack
dsh plugin --profile web add file:$PWD/cache-sentinel-<version>.tgz
systemctl --user restart deepseek-harness   # 新しいコードは再起動でしか読み込まれない
```
**注意**: 版を上げたら、有効化や設定変更より先に DSH を再起動すること。再起動前に無効→有効を切り替えても、
プロセス内の古いモジュールが使われる(2026-10-15 にこれで旧版が動いた)。

## 設定 (profile の `cordis.patch.yml`)
```yaml
- id: cache-sentinel
  config:
    idleMinutes: 60       # 失効とみなす経過時間(分)
    unlockTtlMinutes: 10  # /unlock の有効時間(分)
    dryRun: false         # true で止めずにログだけ出す
```
設定の変更は再起動なしで反映される(プラグインが新しい設定で起動し直す。許可は消える)。

## ログ
`journalctl --user -u deepseek-harness | grep cache-sentinel`。ブロック・許可・起動を `[cache-sentinel]` 付きで出す。

## 制限
- GUI にバッジやブロック理由は出ない(ターンが blocked で終わるだけ)。理由はログか `/unlock` の表示で確認する。
- サブエージェントのセッションでは GUI から `/unlock` を打てない。
- タイトル自動生成は最初の送信時に独立してモデルを呼ぶ(新規セッションとフォークの初回のみ、送るのは最初のメッセージだけ)。
- キャッシュの実際の寿命はプロバイダとリクエスト内容で決まる。本プラグインは経過時間だけで判定する近似。

## 開発
`pnpm test`(node:test)/ `pnpm run typecheck` / `pnpm run build`。
`scripts/dsh-rpc.mjs` で DSH の RPC を直接呼べる(systemd で動かしている環境専用の検証用)。
- `node scripts/dsh-rpc.mjs workspace/unarchiveSession '{"sessionId":"..."}'`
- `node scripts/dsh-rpc.mjs --args commands/execute '{"agentId":"<sessionId>","line":"/unlock","submittedAttachments":[]}'`
