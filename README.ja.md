# cache-sentinel

[English](README.md) | 日本語 | [简体中文](README.zh-CN.md)

DeepSeek Harness（DSH）で、プロンプトキャッシュが切れた古いセッションへのうっかり送信を防ぐプラグインです。

最後の応答から時間が経ったセッションにそのまま続きを送ると、溜まった会話履歴のすべてにキャッシュなしの通常料金がかかります。`cache-sentinel` は最終応答からの経過時間を監視し、古いセッションへの送信を自動で止めたり、セッション自体を自動でアーカイブしたりして誤送信を防ぎます。

## 概要

プロンプトキャッシュの有効時間が過ぎたセッションに対して、次の 2 つの方法で誤送信を防げます。

- **入力禁止（`block`）**：セッションは開いて読めるまま、あなたの送信だけを止めます。エージェントが進めている作業（ツールの実行・ジョブ・サブエージェント・ゴール・リマインダー）は止めません。続けて送りたいときは、入力欄の上のボタンか `/unlock` コマンドで次の 1 回だけを許可できます。
- **自動アーカイブ（`archive`）**：しばらく更新のないセッションを自動でアーカイブし、サイドバーから隠して開けないようにします。

両方を組み合わせる `both` モード（60 分で入力禁止、24 時間でアーカイブ）や、一時的に機能を止める `off` モードへ、チャットの `/sentinel` コマンドからいつでも切り替えられます（公式 Web UI では、引数つきの `/sentinel` は現在入力欄から実行できません。[#36](https://github.com/AliceSaikawa/cache-sentinel/issues/36)）。

## 導入

1. 次の 1 コマンドを実行します。

   ```sh
   dsh plugin --profile web add github:AliceSaikawa/cache-sentinel
   ```

   `web` は例です。実際に使っているプロファイル名を指定してください。cache-sentinel が動くのは `web`・`desktop` など Web アプリを含むプロファイルだけです（[対応バージョン・動作環境](#対応バージョン動作環境)を参照）。

   この指定では `main` の最新を導入します。版を固定するときは、末尾に `#v<版>` の形でタグを付けます（例：`github:AliceSaikawa/cache-sentinel#v1.2.3`）。`v0.5.0` 以前のタグはビルド済みの `lib/` を含まないため、この方法では導入できません。GitHub Releases に添付した `cache-sentinel.tgz` の URL を指定して導入することもできます。

2. DSH を再起動します。

   プラグインのコードは DSH の起動時に読み込まれるため、追加後は再起動が必要です。

   systemd のユーザーサービスとして動かしている場合の例：

   ```sh
   systemctl --user restart deepseek-harness
   ```

### 確認・更新・削除

- **導入の確認**：
  ```sh
  dsh plugin --profile web list cache-sentinel --depth 0
  ```
- **更新**：導入と同じコマンドをもう一度実行して最新版を追加し直したあと、**必ず DSH を再起動**してください（再起動する前に無効→有効を切り替えても、プロセス内の古いコードがそのまま使われます）。
- **削除**：
  ```sh
  dsh plugin --profile web remove cache-sentinel
  ```

## 使い方

### モード

| モード | 動作 |
|---|---|
| `block`（既定） | 最終応答から `idleMinutes`（既定 60 分）を超えたらユーザーの送信を止める（閲覧は可能）。エージェントが進めている作業は止めない。`/unlock` で次の 1 回を許可 |
| `archive` | 最終更新から `idleMinutes`（既定 60 分）を超えたら自動アーカイブ（サイドバーから非表示になり開けなくなる） |
| `both` | 最終応答から `idleMinutes`（既定 60 分）で入力禁止、最終更新から `archiveAfterMinutes`（既定 1440 分 = 24 時間）で自動アーカイブ |
| `off` | 入力禁止もアーカイブも行わない（`/sentinel` と `/unlock` コマンドは実行可能） |

### `/sentinel` コマンド

チャットの入力欄から、現在の状態の確認とモードの切り替えができます。

- `/sentinel`：現在の実効モードとその出どころ（`/sentinel` で設定 / YAML の設定）、しきい値、このセッションの最終応答からの経過分、`dryRun` の状態を表示します。
- `/sentinel block` | `archive` | `both` | `off`：実効モードを切り替えます。`$DSH_HOME/cache-sentinel/profiles/<プロファイル名>/state.json`（プロファイルごと）に保存され、DSH 再起動後も維持されます（YAML の `mode` より優先）。
- `/sentinel default`：`/sentinel` で保存したモードを消去し、YAML の `mode` 設定に戻します。
- 注意：公式 Web UI では、引数つきの `/sentinel`（`block`・`archive`・`both`・`off`・`default`）は現在入力欄から実行できず、普通のメッセージとして送られます（[#36](https://github.com/AliceSaikawa/cache-sentinel/issues/36)）。引数なしの `/sentinel` と `/unlock` は使えます。修正されるまでは、モードは YAML の `mode` で切り替えてください。

### `/unlock` コマンド

- 入力禁止（`block` / `both` モード）で失効しているセッションで `/unlock` を実行すると、次の送信を 1 回だけ許可します。許可は `unlockTtlMinutes`（既定 10 分）で失効します。
- 許可後にモデル応答（`step/end`）が 1 回返ると許可は役目を終え、その後は通常の判定に戻ります（応答直後は失効していないため、そのまま会話を続けられます）。
- まだ失効していないセッションや、モデル応答がまだないセッションで実行した場合は、許可を記録せず現在の経過時間や状態を表示します。

## UI での表示

- **表示言語**：文言は環境に従います。Host は `LC_ALL`・`LC_MESSAGES`・`LANG`・システムロケールの順に判定し、公式 Web UI はブラウザの言語（`navigator.languages`）で判定します。対応するのは英語・日本語・簡体字中国語で、未対応の言語は英語になります。ログ出力（`[cache-sentinel]` で始まる行）は日本語のままです。
- **ブロックしたとき（公式 Web UI・M3E 共通）**：
  - 会話内に「送信を止めました(最終応答から N 分。キャッシュが切れている可能性が高いため)。」「/unlock で次の 1 回を許可できます。」と、破棄された入力テキスト（1 件あたり 2000 文字まで）がコマンド結果の行として表示されます。
  - 同じ入力を送り直して連続で止まったときは、通知が積み重ならないよう 10 分に 1 件だけ表示します（入力が変わったときと、間に送信が通ったときはすぐ表示します）。止めること自体は毎回行われます。
- **送信前のバナー表示**：
  - **公式 Web UI**：クライアントプラグイン（`lib/client.js`）が入力欄の上（`conversation.input.dock`）に状態バナーを表示します。
    - 失効中：「キャッシュ切れ(最終応答から N 分)。このまま送ると止められます。」と「次の 1 回を許可(/unlock)」ボタン
    - 許可中：「次の送信を許可中(キャッシュなしの料金になります)。あと M 分」
    - ボタンで `/unlock` を実行できなかったときは、警告の下に理由が出ます。そのときは入力欄から `/unlock` を送ってください。
  - **M3E（`dsh-webui-m3e`）**：ブロック時の会話行は表示されますが、M3E は他プラグインのクライアントバンドルを読み込まないため、送信前のバナー表示には M3E 側の対応が必要です。
- **他のプラグインとの併用（rdsh-ui-comfort など）**：
  - 1 回目の Enter を改行に変えるプラグイン（`rdsh-ui-comfort` など）を併用していると、1 回目の Enter では送信されず改行が入るだけです。これはプラグインの打鍵の扱いによるもので、cache-sentinel は入力をブロックしていません。続けて（rdsh-ui-comfort の既定では 1.5 秒以内に）もう一度 Enter を押すと送信され、そのとき失効中ならサーバー側で止められて会話にブロック通知が出ます。間を置いてから押した Enter は、また改行が入るだけです。
- **状態の取得 API**：
  - `GET /api/cache-sentinel.status?sessionId=<id>`（Connection の認証つき）でセッションの状態 JSON を返します。

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
    # stateFile: /path/to/state.json # 永続状態ファイルのパス(既定: $DSH_HOME/cache-sentinel/profiles/<プロファイル名>/state.json)
```

- `cordis.patch.yml` の設定変更は DSH の再起動なしで反映されます（プラグインが新しい設定で再適用され、メモリ上の `/unlock` の許可は消えます）。
- 未知のキーや型・範囲が不正な値を指定した場合はエラーになります。

## 仕組み

### 入力禁止（`block` / `both` モード）

- `agent/pre-step` フックの先頭（`prepend: true`）でステップ開始前に判定します。自動圧縮（`dsh-compaction-basic`）より先に判定するため、止めたステップでは自動圧縮によるモデル呼び出しも発生しません。
- 止めるのは、ユーザーの送信（`source.kind` が `user` のメッセージ）を含むターンの最初のステップだけです。次のステップはキャッシュが切れていても通し、キャッシュなしで送られることがあります。
  - 同じターンの 2 ステップ目以降（ターンの途中に届いたジョブの完了通知や割り込みの送信など）。ツール実行の後の続きもここに入りますが、最終応答時刻はツールが終わった時点の `step/end` で新しくなるため、通常は失効と判定されません（[制限](#制限)）。
  - ユーザーの送信を含まずに始まるターン（バックグラウンドジョブの完了通知、サブエージェントからのメッセージと完了通知、ゴールの自動継続、リマインダー、webhook。webhook は DSH 0.2.0-rc.2 のみ）。
- 失効したステップをこの理由で通したときは、その旨をログに出します（[ログの見方](#ログの見方)）。
- ユーザーの送信が他の入力（待っていたジョブの完了通知など）と同じステップに入った場合は、ステップごと止め、その入力も破棄されます。
- 経過時間はセッションの最後の `step/end` イベント時刻（フォーク元から引き継いだ履歴を含む）から計算します。ただしサブエージェントが fork した子セッションでは、引き継いだ履歴の代わりに子の作成時刻と子自身の `step/end` の新しい方を使います（fork は親の実行中に起きるため）。まだモデル応答がない新規セッションや、経過時間が `idleMinutes` 分ちょうど以内の場合はそのまま通します。
- ステップを拒否したときは API リクエストが発生せず、料金はかかりません。**そのステップに入る予定だった送信メッセージは破棄される**ため、解除後に再入力してください（破棄されたテキストは会話内のブロック通知に表示されます）。

### アーカイブ（`archive` / `both` モード）

- プラグイン有効化時と `checkIntervalSeconds` 秒ごとにセッション一覧をチェックします。
- 最終更新時刻（`lastActivityAt`）は、セッションログファイル（`session.v*.jsonl[.zstd]`）の `mtime`、ロード済みセッションの末尾イベント時刻、手動でアーカイブ解除された時刻の最大値（いずれもなければ作成時刻）です。
- アーカイブモードが初めて有効になった基準時刻（`baselineAt`）より前に更新が止まっていたセッションは、既定ではアーカイブしません（`archiveExisting: true` で対象になります）。
- ピン留めされたセッション（`skipPinned: true` の場合）、サブエージェントのセッション、実行中の作業（ターン・ジョブ・サブエージェント・リマインダー）があるセッションは対象外です。
- 手動でアーカイブを解除したセッションは、解除が検出された時点から再びしきい値分の猶予があります。

## 制限

- **複数プロファイルの同時利用**：`state.json` はプロファイルごと（`$DSH_HOME/cache-sentinel/profiles/<プロファイル名>/state.json`）に分かれるため、モード・`baselineAt`・解除の記録は互いを上書きしません。以前の版から更新すると、各プロファイルの最初の起動時に従来の `$DSH_HOME/cache-sentinel/state.json` の内容を引き継ぎます（従来のファイルは消さず、以後は読みません）。プロファイル名が取れない環境では従来のファイルを使います。ただしアーカイブ状態は DSH の共有ファイル `$DSH_HOME/storages/workspace.json` にあり、プラグインからは分離できません。DSH は起動時に 1 回読んで以後再読込せず、書き込みでファイル全体を置き換えるため、2 つのプロファイルを同時に動かすと、一方のアーカイブ / アンアーカイブ / ピンの変更がもう一方の書き込みで失われることがあります。**`archive` / `both` を使う場合は、どれか 1 つのプロファイルでのみ有効にしてください。**
- M3E では他プラグインのクライアントバンドルを読み込まないため、送信前のバナー表示には M3E 側の対応が必要です（ブロックしたときの会話内の通知は Host 側のみで表示されます）。
- サブエージェントのセッションでは GUI から `/unlock` を実行できません。親エージェントからのメッセージは止めませんが、GUI からサブエージェントに直接送ったメッセージは、サブエージェント側でキャッシュが切れていれば止まります。
- ユーザーの操作によるものでも、通常の送信ではない入力は止めません。
  - `/goal <目標>` によるゴールの作成、`/goal edit` による編集、ゴールの再開。キャッシュが切れていてもゴールは走ります。
  - 添付を付けた `/goal`。添付は通常の送信として先に入るため止められて破棄され、ゴールは添付なしで走ります（コードから読み取った挙動で、実機では未確認です）。
  - キャッシュが切れた後の質問（`ask_user_question`）への回答。止めると回答は破棄されます。質問は回答待ちに戻りますが、答えたつもりでいると答え直しが要ることに気づきにくいためです。
- `idleMinutes` を超えるツール実行の後の続きは、キャッシュなしで送られますが検出しません（ログも出ません）。最終応答時刻は、ツールが終わった時点の `step/end` で新しくなるためです。
- タイトル自動生成（`session-title-first-prompt-llm`）は最初の送信時に独立してモデルを呼び出すためゲートの対象外です（新規セッションやフォークの初回のみで、送信されるのは最初のメッセージだけです）。
- プロンプトキャッシュの実際の寿命はプロバイダとリクエスト内容によって決まります。本プラグインは経過時間だけで判定する近似です。

## トラブルシューティング

### プラグインを更新したあとは DSH を再起動する

`dsh plugin --profile web add ...` で新しい版を追加し直したあとは、プラグインの有効化や設定変更を行う前に **DSH を再起動**してください。再起動せずにプラグインの無効→有効を切り替えても、プロセス内に残っている古いモジュールが再利用されます。

### ログの見方

起動・ブロック・失効していても通したステップ・`/unlock` の許可・モード変更・アーカイブは `[cache-sentinel]` プレフィックス付きで標準出力 / 標準エラーおよび DSH のロガーに出力されます。

systemd のユーザーサービス（`deepseek-harness`）として動かしている場合のログ確認例：

```sh
journalctl --user -u deepseek-harness | grep cache-sentinel
```

## 開発

```sh
pnpm test          # 単体テスト (node --test)
pnpm run typecheck # 型チェック (tsc --noEmit)
pnpm run build     # ビルド (lib/index.js, lib/client.js)
```

`github:` 指定での導入はビルドを行わないため、ビルド済みの `lib/` もリポジトリに含めています。`src/` を変えたら `pnpm run build` を実行し、`lib/` も合わせてコミットしてください。

`main` への push と pull request では、CI(`.github/workflows/ci.yml`)が Linux と Windows で同じ 3 つのコマンドを実行し、コミットされた `lib/` がビルド結果と一致することも確認します。リリースは `v*` タグの push で行い(`.github/workflows/release.yml`)、タグ名が `package.json` の `version` と一致しないと失敗します。ビルドした `cache-sentinel.tgz` が GitHub Release に添付されます。

ソースからビルドしてローカルの `.tgz` を導入する場合：

```sh
git clone https://github.com/AliceSaikawa/cache-sentinel.git
cd cache-sentinel
pnpm install
pnpm run build
pnpm pack
dsh plugin --profile web add file:$PWD/cache-sentinel-$(node -p "require('./package.json').version").tgz
```

`scripts/dsh-rpc.mjs` は、DSH を `deepseek-harness` ユーザー systemd サービスとして動かしている環境で、journal の起動 URL からトークンを取得して DSH の RPC を直接呼ぶ検証用スクリプトです。

```sh
node scripts/dsh-rpc.mjs workspace/unarchiveSession '{"sessionId":"..."}'
node scripts/dsh-rpc.mjs --args commands/execute '{"agentId":"<sessionId>","line":"/unlock","submittedAttachments":[]}'
```

`scripts/dsh-compat.ts` は、cache-sentinel が使う `@deepseek-ai/*` の各パッケージが DSH の版によって変わったかを調べます。新しい DSH の版が出たら、確認済みの版と各パッケージを比べ、`same`（変更なし。互換の見込み）/ `diff`（変更あり。人が差分を読む）/ `missing`（取得失敗）を報告します。

```sh
node scripts/dsh-compat.ts /var/tmp/dsh-compat 0.2.1-rc.1 0.2.1-rc.2
```

同じ確認は GitHub Actions でも実行できます(`.github/workflows/dsh-compat.yml`)。Actions > DSH compat > Run workflow から、基準の版と比べる版(空白区切り)を指定して起動します。`next` などの dist-tag は `@deepseek-ai/dsh` の版に解決します。結果はジョブのサマリーに出ます。ジョブが失敗するのは `missing` があるときだけで、`diff` は人が読んで判断します。スクリプトかワークフローを変える pull request では、固定の組み合わせ(`0.2.1-rc.1` と `0.2.1-alpha.5`)で自動的に実行されます。

設計・仕様・調査の詳細は [docs/](docs/README.md) を参照してください。

- [docs/spec.md](docs/spec.md)：全体仕様（モード切り替え・入力禁止）
- [docs/spec-ui.md](docs/spec-ui.md)：UI 表示・ステータス API 仕様
- [docs/archive-spec.md](docs/archive-spec.md)：アーカイブモード仕様
- [docs/spike.md](docs/spike.md)：DSH 本体 API の調査記録

## 対応バージョン・動作環境

- **DeepSeek Harness（DSH）**：**0.2.0-rc.2 〜 0.2.1-rc.2**（0.2.1-alpha.1〜alpha.5 を含む）
  - 対応範囲は `package.json` の `peerDependencies`（`"@deepseek-ai/dsh": ">=0.2.0-rc.2 <=0.2.1-rc.2"`）で宣言しています。DSH はプラグインの追加時とプロファイル起動時にこの範囲を検査します。範囲外の DSH ではプラグインが拒否されて読み込まれません（DSH 自体の起動は続き、理由が表示されます）。どうしても動かす場合は、プロファイルの `compatibility.json` にプラグインの版と DSH の版の組を完全一致で免除します（`dsh plugin --profile <プロファイル> allow-version cache-sentinel@<版> --dsh-version <DSH の版> --accept-risk`）。**0.2.1 の正式版は範囲外**です（2026-10-23 時点で未リリースのため）。
  - **0.2.0-rc.2・0.2.1-rc.1**：npm で配布されている DSH の実機で確認（`web` プロファイル、2026-10-18）。確認した機能は、入力禁止・`/unlock`・`/sentinel`（引数なしは入力欄から。引数つきは RPC の `commands/execute` からのみ。[#36](https://github.com/AliceSaikawa/cache-sentinel/issues/36)）・アーカイブのサイクル・会話内のブロック通知・入力欄の上のバナー。2 つの版で結果は同じでした。使った cache-sentinel は main の `86a77f6` で、バナーのボタンの修正（[#34](https://github.com/AliceSaikawa/cache-sentinel/pull/34)）より前のため、ボタンは動きませんでした。修正後のボタンは 0.2.0-rc.2 でだけ確認しています。詳細は [docs/dsh-version-check.md](docs/dsh-version-check.md) を参照。
  - **0.2.1-rc.2**：実機は未確認。cache-sentinel が使う API の型定義と実装を 0.2.1-rc.1 と比べて確認（2026-10-23）。違いは `dsh-client-modules` のビルド識別子と、`dsh-base`・`dsh-web-app` のバンドルへの行の追加だけでした。根拠は [docs/spike.md](docs/spike.md) を参照。
  - **0.2.1-alpha.1〜alpha.5**：実機は未確認。cache-sentinel が使う API の型定義と実装を 0.2.0-rc.2 と比べて確認（2026-10-17）。根拠は [docs/spike.md](docs/spike.md) を参照。
  - 新しい版が出たときの確認は [scripts/dsh-compat.ts](scripts/dsh-compat.ts) で行えます。
- **DSH のプロファイル**：`web` と `desktop`。`dsh.profile.bundles` に `@deepseek-ai/dsh-web-app` を含むプロファイルが対象です（`web` のテンプレートから作ったプロファイルも含みます）。cache-sentinel が使う `workspaceRegistry` と `connection` のサービスは、このバンドルにしかありません。
  - `headless`・`acp` などほかのプロファイルでは、cache-sentinel は起動しません。サービスを待ったままになるため、入力禁止・アーカイブ・`/sentinel`・`/unlock` のいずれも使えません。エラーは出ず、`[cache-sentinel]` の起動ログも出ません。
  - `desktop` は `web` と同じバンドルを使いますが、実機では未確認です。npm 版の `dsh` CLI は `desktop` プロファイルのプラグイン管理を受け付けないため、Desktop アプリと一緒に入る `dsh` コマンドで追加してください。
- **Node.js / pnpm**：通常の DSH CLI はプラグイン追加時に `PATH` 上の `pnpm` を使用します（`github:` 指定や Releases の `.tgz` から導入する場合、利用者側でのビルドは不要です）

## ライセンス

MIT License — [LICENSE](LICENSE) を参照してください。
