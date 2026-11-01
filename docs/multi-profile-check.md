# 複数プロファイルの同時利用での競合の確認 (Issue #9, 2026-11-02)

> この文書は開発時の記録です。

同じ `$DSH_HOME` を使う 2 つのプロファイルで cache-sentinel を同時に動かし、`state.json` とアーカイブ状態
(`$DSH_HOME/storages/workspace.json`)が競合するかを実機で確かめた記録。修正(#44)より前の版と、修正後の版の両方で
同じ操作をした。

## 結論

| 項目 | 修正前(`aba5b45`) | 修正後(main `73afe68`) |
|---|---|---|
| 一方の `/sentinel` で変えたモードが、もう一方の書き込みで `state.json` から消える | 再現した | 再現しない(ファイルがプロファイルごとに分かれる) |
| `baselineAt`・`unarchivedAt` を互いに上書きする | 再現した | 再現しない |
| 再起動すると、もう一方が書いたモードで起動する | 再現した | 再現しない |
| 従来の共有ファイルからの移行(各プロファイルの最初の起動で引き継ぎ、従来のファイルは変えない) | (該当なし) | 動作 |
| アーカイブ状態はプロファイル間で共有される | 共有される | 共有される(変わらない) |
| 両方の cache-sentinel が同じセッションをアーカイブする | 起きた(エラーは出ない) | 起きた(エラーは出ない) |
| 一方の手動解除・アーカイブが、もう一方の書き込みで `workspace.json` から消える | 再現した | 再現した(DSH 側の挙動。cache-sentinel では防げない) |

再現の条件:

- `state.json`(修正前): 2 つのプロセスがどちらも `state.json` に書くとき。書くのは、`/sentinel` でのモード変更
  (`default` を含む)、アーカイブが初めて有効になったときの `baselineAt` の記録、`unarchivedAt` の変化(手動解除の検出と
  古い記録の掃除)の 3 つ。各プロセスは起動時に 1 回だけファイルを読み、書くときは自分のメモリ上の状態でファイル全体を
  置き換えるので、後から書いた側の内容だけが残る。一方が `block`/`off` のまま `/sentinel` も使わなければ、その一方は
  書かないので起きない。ファイルは壊れず(atomic rename)、ログにも何も出ない。
- `workspace.json`(修正前後とも): 2 つのプロセスのどちらかがアーカイブ・手動解除・ピンを変えたとき。DSH の
  `WorkspaceRegistry` は起動時に 1 回だけ読み、書くときは自分のメモリ上の状態でファイル全体を置き換える
  ([spike.md](spike.md) Z4)。cache-sentinel を `archive`/`both` にすると、アーカイブのサイクルがこの書き込みを
  定期的に起こすので、手でアーカイブ・解除しなくても起きる。

方針: `state.json` は #44 でプロファイルごとに分けた(単体テストは `tests/index.test.ts` の T39、この記録で実機も確認)。
アーカイブ状態は DSH 側の共有ファイルなので、README の Limitations で「`archive`/`both` は 1 つのプロファイルでだけ
有効にする」と案内する(#44 で記述済み。この記録の結果と合っている)。

## 環境

- DSH: このマシンに入っている npm 版 `@deepseek-ai/dsh` 0.2.2-alpha.2(cache-sentinel の対応範囲内)。
- `HOME`・`DSH_HOME`・`XDG_*`・`TMPDIR` を作業ディレクトリに向けて隔離した。版(修正前・修正後)ごとに別の `DSH_HOME` を使った。
  利用者の `~/.dsh` と動いている GUI には触れていない。
- プロファイル: `web`(テンプレートの既定)と `web2`(`dsh web2 --from-default-profile web` で作った)。npm 版の `dsh` CLI は
  `desktop` プロファイルの作成と起動を拒否する(`profile "desktop" is managed exclusively by the Electron application`)ので、
  Desktop の代わりに `web` のテンプレートから作った 2 つ目のプロファイルを使った。どちらも同じ `$DSH_HOME` を使う点は
  Desktop と同じ([spike.md](spike.md) Z4)。2 つを別のポートで同時に起動した(`dsh web --no-open --port …`)。
- cache-sentinel: `dsh plugin --profile <名前> add file:<tgz>` で両方のプロファイルに入れた。
  - 修正前: `aba5b45`(#44 の直前の main。版は 0.5.0)の `pnpm pack`。sha256 は `045f211c3f71fd0cfc5c05bdea84cfe1c0b8d6d9f94522d1dfc26db59ac61ce4`。
  - 修正後: main `73afe68`(版は 0.6.0)の `pnpm pack`。sha256 は `bcf06c78bc1093ee01f660380733d5048b883bb6a7eca7b0849b7a1ce7cbbfed`。
  - どちらも中の `lib/` はコミット済みの `lib/` のまま。
- 設定: 両方のプロファイルの `cordis.patch.yml` に `mode: block`、`idleMinutes: 1`、`checkIntervalSeconds: 10`。
- 操作: RPC(起動 URL のトークンで Cookie を得て `/api/<メソッド>` を呼ぶ)。`session/create` でセッションを作り、
  `commands/execute` で `/sentinel …` を、`workspace/unarchiveSession`・`workspace/archiveSession` で手動の解除とアーカイブをした。
  LLM は使っていない(セッションにはモデル応答が無い。アーカイブ判定の最終活動時刻は作成時刻とコマンドの記録)。
- 観察: サーバーログ(`[cache-sentinel]` の行)、RPC の応答(`workspace/*` は各プロセスのメモリ上のアーカイブの集合を返す)、
  `state.json`・`workspace.json` の内容(100 ms ごとに読み、変わるたびに時刻つきで記録した)。生ログはコミットしない。

以下、`web` で作ったセッションを S1・S3、`web2` で作ったセッションを S2・S4・S5 と書く。

## 手順と結果: 修正前(`aba5b45`)

1. `web` と `web2` を同時に起動した。どちらも `開始 (モード block, …)`。`$DSH_HOME/cache-sentinel/` はまだ無い。
2. `web` で `/sentinel archive`。`state.json` は `{ mode: "archive", baselineAt: <web の時刻> }`。
3. `web2` で `/sentinel off`。`state.json` は `{ mode: "off" }` になり、`web` が書いた `mode` と `baselineAt` が消えた。
   `web` の `/sentinel` は「モード archive」のまま(メモリ上の状態)で、ファイルとずれる。
4. `web2` で `/sentinel archive`。`state.json` の `baselineAt` は `web2` の時刻になった(`web` の値が置き換わる)。
5. 1 分あまりで、`web` は `1 件をアーカイブしました`・`3 件をアーカイブしました`、`web2` は `3 件をアーカイブしました`。
   セッションは 4 つなので、S2・S3・S4 は両方のプロセスがアーカイブした(手順 6・7 の RPC の応答にある各プロセスの集合で確認)。
   エラーは出ない(DSH の `archiveSession` は自分のメモリ上で済んでいる id では何もしない)。
6. `web` で S3 を手で解除した(`workspace/unarchiveSession`)。`workspace.json` から S3 が消えた。
   次のサイクルで `web` の cache-sentinel は `手動解除を検出しました: S3` を出し、`state.json` を
   `{ unarchivedAt: { S3: … }, mode: "archive", baselineAt: <web の時刻> }` で書いた(`web2` の `baselineAt` が置き換わる)。
7. `web2` で S5 を作り、手でアーカイブした(`workspace/archiveSession`)。`workspace.json` は `web2` のメモリ上の集合
   `[S2, S3, S4, S5]` になった。`web` の解除(S3)が消え、`web` のアーカイブ(S1)も消えた(`web2` は S1 のアーカイブを知らない)。
8. 解除から 1 分(猶予)後、`web` の cache-sentinel が S3 を再びアーカイブし、`workspace.json` は `web` のメモリ上の集合
   `[S1, S2, S4, S3]` になった。今度は `web2` のアーカイブ(S5)が消えた。10 秒後の次のサイクルで `web` は S5 もアーカイブした。
9. `web2` で `/sentinel off`。`state.json` は `{ mode: "off", unarchivedAt: {}, baselineAt: <web2 の時刻> }` になり、
   `web` の `unarchivedAt` も消えた。
10. `web` を再起動すると `開始 (モード off, …)`。`web` で選んだ `archive` は失われた。

## 手順と結果: 修正後(main `73afe68`)

1. 従来の共有ファイル `$DSH_HOME/cache-sentinel/state.json` を `{ version: 2, mode: "block", baselineAt: …, unarchivedAt: {} }` で
   置いてから、`web` と `web2` を同時に起動した。それぞれ `状態ファイルを作りました: …/cache-sentinel/profiles/<名前>/state.json(従来の … から引き継ぎ…)`
   と `状態ファイル: …/cache-sentinel/profiles/<名前>/state.json` を出した。2 つのファイルの値は従来のファイルと同じ(キーの順だけが違う)。
2. `web` で `/sentinel archive`、`web2` で `/sentinel off`。`profiles/web/state.json` は `mode: "archive"`、
   `profiles/web2/state.json` は `mode: "off"` で、互いに変わらない。`web` の `/sentinel` は「モード archive」。
3. `web2` で `/sentinel archive`。変わったのは `profiles/web2/state.json` だけ。
4. 1 分あまりで、`web` も `web2` も `1 件をアーカイブしました`・`3 件をアーカイブしました`。修正前と同じく、
   同じセッションを両方がアーカイブした。エラーは出ない。
5. `web` で S3 を手で解除し、続けて `web2` で S5 を作って手でアーカイブした。`workspace.json` は `[S1, S2, S3, S4, S5]` になり、
   `web` の解除(S3)は消えた(修正前の手順 7 と同じ。アーカイブ状態は分けていないので想定どおり)。
   `web` の cache-sentinel は `手動解除を検出しました: S3` を出し、`profiles/web/state.json` にだけ `unarchivedAt` を書いた。
6. `web` を止めてから `web2` で `/sentinel off`。変わったのは `profiles/web2/state.json` だけ。
7. `web` を再起動すると `開始 (モード archive, …)` と `状態ファイル: …/profiles/web/state.json`。
   2 回目の起動なので「状態ファイルを作りました」は出ない。従来の共有ファイルは最初から最後まで変わらない(sha256 が同じ)。

## 確認していないこと

- Desktop アプリそのもの(このマシンでは動かせない)。Desktop で `profileContext` の名前が取れて
  `profiles/desktop/state.json` が使われることは、[rdsh-check.md](rdsh-check.md) の「Desktop の実機確認」7 の手順で確かめる。
- macOS・Windows での動作。
- LLM の応答があるセッション(最終応答時刻を基準にする判定)。今回の競合はファイルの書き方によるもので、判定の中身には依存しない。
- GUI の表示。手順 7・8 の「消えた」はファイルの内容で、各プロセスの GUI はそれぞれのメモリ上の状態を表示するはず(未確認)。
  再起動するとファイルの内容が読まれる。
