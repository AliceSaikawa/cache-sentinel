# cache-sentinel

DSH (DeepSeek Harness) 用の Host / Web クライアントプラグインです。
プロンプトキャッシュが切れた(最後のモデル応答から一定時間が経過した)セッションへの誤送信を止め、長い会話履歴全体が通常のインプット料金で課金されるのを防ぎます。

## 概要

プロンプトキャッシュには有効時間があり、最後の応答から時間が経ったセッションにそのままメッセージを送信すると、蓄積されたコンテキスト全体に対してキャッシュなしのインプット料金が発生します。

`cache-sentinel` は最終応答(または最終更新)からの経過時間を監視し、次の 2 つの方法で誤送信を防ぎます。

- **入力禁止 (`block`)**: セッションの閲覧はそのまま許可し、モデルを呼び出すステップだけを拒否します。続けて送信したい場合は `/unlock` コマンド(または UI 上のボタン)で次の 1 回だけを許可できます。
- **自動アーカイブ (`archive`)**: 一定時間更新のないセッションを自動でアーカイブし、サイドバーから隠して開けないようにします。

これらを組み合わせた `both` モードや、一時的に無効化する `off` モードへ `/sentinel` コマンドでいつでも切り替えられます。

## 仕組み

### 入力禁止 (`block` / `both` モード)
- `agent/pre-step` フックの先頭(`prepend: true`)でステップ開始前に判定します。自動圧縮(`dsh-compaction-basic`)より先に判定するため、キャッシュ切れのセッションでは自動圧縮によるモデル呼び出しも発生しません。
- 止める対象はメッセージの出どころを問いません。ユーザーの送信、リマインダー、ゴールの自動継続、バックグラウンドジョブの完了通知、サブエージェントの継続、長いツール実行後の次ステップすべてが対象です。
- 経過時間はセッションの最後の `step/end` イベント時刻(フォーク元から引き継いだ履歴を含む)から計算します。まだモデル応答がない新規セッションや、経過時間が `idleMinutes` 分ちょうど以内の場合はそのまま通します。
- ステップを拒否したときは API リクエストが発生せず、料金はかかりません。**そのステップに入る予定だった送信メッセージは破棄される**ため、解除後に再入力してください(破棄されたテキストは会話内のブロック通知に表示されます)。

### アーカイブ (`archive` / `both` モード)
- プラグイン有効化時と `checkIntervalSeconds` 秒ごとにセッション一覧をチェックします。
- 最終更新時刻(`lastActivityAt`)は、セッションログファイル(`session.v*.jsonl[.zstd]`)の `mtime`、ロード済みセッションの末尾イベント時刻、手動でアーカイブ解除された時刻の最大値(いずれもなければ作成時刻)です。
- アーカイブモードが初めて有効になった基準時刻(`baselineAt`)より前に更新が止まっていたセッションは、既定ではアーカイブしません(`archiveExisting: true` で対象になります)。
- ピン留めされたセッション(`skipPinned: true` の場合)、サブエージェントのセッション、実行中の作業(ターン・ジョブ・サブエージェント・リマインダー)があるセッションは対象外です。
- 手動でアーカイブを解除したセッションは、解除が検出された時点から再びしきい値分の猶予があります。

## 必要環境

- **DSH (DeepSeek Harness)**: `0.2.0-rc.2` で調査・動作確認([docs/spike.md](docs/spike.md))
- **Node.js / pnpm**: ソースからのビルド・テスト実行時に使用

## 導入

リポジトリをビルドしてパッケージを作成し、DSH のプロファイルに追加したあと、DSH を再起動します。

```sh
pnpm install && pnpm test && pnpm run build && pnpm pack
dsh plugin --profile web add file:$PWD/cache-sentinel-<version>.tgz
```

追加後、**DSH を再起動**してください(新しいプラグインコードはプロセスの再起動時に読み込まれます)。

systemd のユーザーサービスとして動かしている場合の再起動例:

```sh
systemctl --user restart deepseek-harness
```

## 使い方

### モード

| モード | 動作 |
|---|---|
| `block` (既定) | 最終応答から `idleMinutes`(既定 60 分)を超えたら入力禁止(閲覧は可能)。`/unlock` で次の 1 回を許可 |
| `archive` | 最終更新から `idleMinutes`(既定 60 分)を超えたら自動アーカイブ(サイドバーから非表示になり開けなくなる) |
| `both` | 最終応答から `idleMinutes`(既定 60 分)で入力禁止、最終更新から `archiveAfterMinutes`(既定 1440 分 = 24 時間)で自動アーカイブ |
| `off` | 入力禁止もアーカイブも行わない(`/sentinel` と `/unlock` コマンドは実行可能) |

### `/sentinel` コマンド

チャットの入力欄からモードの確認と切り替えができます。

- `/sentinel`: 現在の実効モードとその出どころ(`/sentinel` で設定 / YAML の設定)、しきい値、このセッションの最終応答からの経過分、`dryRun` の状態を表示します。
- `/sentinel block` | `archive` | `both` | `off`: 実効モードを切り替えます。`$DSH_HOME/cache-sentinel/state.json` に保存され、DSH 再起動後も維持されます(YAML の `mode` より優先)。
- `/sentinel default`: `/sentinel` で保存したモードを消去し、YAML の `mode` 設定に戻します。

### `/unlock` コマンド

- 入力禁止(`block` / `both` モード)で失効しているセッションで `/unlock` を実行すると、次の送信を 1 回だけ許可します。許可は `unlockTtlMinutes`(既定 10 分)で失効します。
- 許可後にモデル応答(`step/end`)が 1 回返ると許可は役目を終え、その後は通常の判定に戻ります(応答直後は失効していないため、そのまま会話を続けられます)。
- まだ失効していないセッションや、モデル応答がまだないセッションで実行した場合は、許可を記録せず現在の経過時間や状態を表示します。

## 設定

プロファイルの `cordis.patch.yml` で設定を変更できます。省略した項目には既定値が使われます。

```yaml
- id: cache-sentinel
  config:
    mode: block               # block / archive / both / off (/sentinel で上書き可能)
    idleMinutes: 60           # 入力禁止のしきい値(分)。archive モードではアーカイブのしきい値(分)
    archiveAfterMinutes: 1440 # both モードでのアーカイブのしきい値(分)
    unlockTtlMinutes: 10      # /unlock の有効時間(分)
    checkIntervalSeconds: 60  # アーカイブのチェック間隔(秒、10 以上)
    skipPinned: true          # ピン留めされたセッションをアーカイブしない
    archiveExisting: false    # 初回有効化より前に止まっていたセッションもアーカイブ対象にする
    maxPerCycle: 20           # 1 サイクルあたりの最大アーカイブ件数
    dryRun: false             # true のときブロックもアーカイブも行わずログのみ出力
    # stateFile: /path/to/state.json # 永続状態ファイルのパス(既定: $DSH_HOME/cache-sentinel/state.json)
```

- `cordis.patch.yml` の設定変更は DSH の再起動なしで反映されます(プラグインが新しい設定で再適用され、メモリ上の `/unlock` の許可は消えます)。
- 未知のキーや型・範囲が不正な値を指定した場合はエラーになります。

## UI での表示

- **ブロックしたとき(公式 Web UI・M3E 共通)**:
  - 会話内に「送信を止めました(最終応答から N 分。キャッシュが切れている可能性が高いため)。」「/unlock で次の 1 回を許可できます。」と、破棄された入力テキスト(1 件あたり 2000 文字まで)がコマンド結果の行として表示されます。
  - 入力メッセージが 0 件のステップ(自動継続など)が連続で拒否された場合は、同じセッションで 10 分に 1 回まで通知を抑制します。
- **送信前のバナー表示**:
  - **公式 Web UI**: クライアントプラグイン(`lib/client.js`)が入力欄の上(`conversation.input.dock`)に状態バナーを表示します。
    - 失効中: 「キャッシュ切れ(最終応答から N 分)。このまま送ると止められます。」と「次の 1 回を許可(/unlock)」ボタン
    - 許可中: 「次の送信を許可中(キャッシュなしの料金になります)。あと M 分」
  - **M3E (`dsh-webui-m3e`)**: ブロック時の会話行は表示されますが、M3E は他プラグインのクライアントバンドルを読み込まないため、送信前のバナー表示には M3E 側の対応が必要です。
- **状態の取得 API**:
  - `GET /api/cache-sentinel.status?sessionId=<id>`(Connection の認証つき)でセッションの状態 JSON を返します。

## 制限

- M3E では他プラグインのクライアントバンドルを読み込まないため、送信前のバナー表示には M3E 側の対応が必要です(ブロックしたときの会話内の通知は Host 側のみで表示されます)。
- サブエージェントのセッションでは GUI から `/unlock` を実行できません。
- タイトル自動生成(`session-title-first-prompt-llm`)は最初の送信時に独立してモデルを呼び出すためゲートの対象外です(新規セッションやフォークの初回のみで、送信されるのは最初のメッセージだけです)。
- プロンプトキャッシュの実際の寿命はプロバイダとリクエスト内容によって決まります。本プラグインは経過時間だけで判定する近似です。

## トラブルシューティング

### プラグインを更新したあとは DSH を再起動する

パッケージの版を上げて `dsh plugin add` し直したあとは、プラグインの有効化や設定変更を行う前に **DSH を再起動**してください。再起動せずにプラグインの無効→有効を切り替えても、プロセス内に残っている古いモジュールが再利用されます。

### ログの見方

起動・ブロック・`/unlock` の許可・モード変更・アーカイブは `[cache-sentinel]` プレフィックス付きで標準出力 / 標準エラーおよび DSH のロガーに出力されます。

systemd のユーザーサービス(`deepseek-harness`)として動かしている場合のログ確認例:

```sh
journalctl --user -u deepseek-harness | grep cache-sentinel
```

## 開発

```sh
pnpm test          # 単体テスト (node --test)
pnpm run typecheck # 型チェック (tsc --noEmit)
pnpm run build     # ビルド (lib/index.js, lib/client.js)
```

`scripts/dsh-rpc.mjs` は、DSH を `deepseek-harness` ユーザー systemd サービスとして動かしている環境で、journal の起動 URL からトークンを取得して DSH の RPC を直接呼ぶ検証用スクリプトです。

```sh
node scripts/dsh-rpc.mjs workspace/unarchiveSession '{"sessionId":"..."}'
node scripts/dsh-rpc.mjs --args commands/execute '{"agentId":"<sessionId>","line":"/unlock","submittedAttachments":[]}'
```

設計・仕様・調査の詳細は `docs/` を参照してください。

- [docs/spec.md](docs/spec.md): 全体仕様(モード切り替え・入力禁止)
- [docs/spec-ui.md](docs/spec-ui.md): UI 表示・ステータス API 仕様
- [docs/archive-spec.md](docs/archive-spec.md): アーカイブモード仕様
- [docs/spike.md](docs/spike.md): DSH 本体 API の調査記録

## ライセンス

MIT License — [LICENSE](LICENSE) を参照してください。
