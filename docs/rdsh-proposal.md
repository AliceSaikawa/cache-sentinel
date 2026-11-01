# rustdsh の推奨プラグインへの追加の提案 (Issue #17, 2026-11-02)

> この文書は開発時の記録と、rustdsh に出す提案の下書きです。rustdsh への提出は人が行います。

Issue #17 の「最後の手順」(rustdsh 側への追加の提案)のために、rustdsh の現状を調べ、変更案をまとめた。

- 対象: rustdsh main `b060ccf`(2026-11-01)。引用は `rustdsh/<パス>:行@b060ccf`。
- #17 の起票時(`3ce1ad8`)から、rustdsh の導入の仕組みが変わった。推奨プラグインの一覧は `plugins/install.sh` のほかに `src/plugin_catalog.json` にもあり、バイナリに組み込まれる。`tests/plugin-catalog.test.mjs` が両者の一致を検査する(`rustdsh/src/plugin_catalog.json:3@b060ccf`、`rustdsh/tests/plugin-catalog.test.mjs:12-17@b060ccf`)。`rdsh plugins install` はこのカタログから導入する(`rustdsh/src/plugins.rs:172-200@b060ccf`)。そのため、変更の対象は #17 本文の 3 ファイルではなく、`plugins/install.sh`・`src/plugin_catalog.json`・`plugins/recommended.md` と、推奨の件数を数える Rust のテスト 1 行(`rustdsh/src/plugins.rs:1253-1256@b060ccf`)になる(`src/desktop.rs` は変更不要。後述の 5)。

## cache-sentinel 側の準備状況

#17 の背景にある「推奨には入れられない 3 点」は、cache-sentinel 側では対応が済んでいる。

| 点 | 状況 | 対応 |
|---|---|---|
| インストール | `github:AliceSaikawa/cache-sentinel` で導入できる。ビルド済みの `lib/` をコミットし、CI がビルド結果との一致を検査する | #14(PR #23)、#11 |
| 対応プラットフォーム | プロファイルは `web`・`desktop`。`headless` などでは起動しない(エラーは出ない)。Windows で state.json を保存できる。CI は Linux と Windows | #15(PR #24)、#6、#11 |
| 対応する DSH の版 | rustdsh が扱う版はすべて main の `peerDependencies`(`>=0.2.0-rc.2 <=0.2.1-rc.5 \|\| 0.2.2-alpha.2`)に入る(下記) | #12、#31、PR #48、PR #51 |
| 既定の挙動 | 既定の `mode: block` のまま、止めるのはユーザーの送信で始まるステップだけ。ジョブの完了通知・サブエージェント・ゴール・リマインダー(rdsh-answer-guard を含む)は止めない | #7(PR #33) |

rustdsh が扱う DSH の版:

- ツールの監査対象: 0.2.0-rc.2、0.2.1-alpha.1、0.2.1-alpha.3、0.2.1-rc.3、0.2.1-rc.4、0.2.2-alpha.2(`rustdsh/src/tool_security.rs:29-64@b060ccf`)
- Desktop の同梱: 0.2.1-alpha.2(`rustdsh/desktop/upstream.lock.json:5-6@b060ccf`)
- headless の実行環境: 0.2.0-rc.2(`rustdsh/scripts/headless-runtime/runtime/package.json:5@b060ccf`)

ただし最新のリリース v0.6.0 の宣言は `>=0.2.0-rc.2 <=0.2.1-rc.3` なので、v0.6.0 のタグや tgz を指定すると、0.2.1-rc.4 と 0.2.2-alpha.2 では追加時に拒否される。main(PR #51 の後)を指す指定なら入る。

## 判断が要る点

### 1. どの段に入れるか

1. **推奨の段に入れ、既定はオフ**(おすすめ): `--recommended=cache-sentinel`・`CACHE_SENTINEL=1`・`--recommended=all` で入る。
2. スターターセットに入れる(web・desktop で既定オン)。
3. 必須の段に入れる。

おすすめの理由: cache-sentinel は導入しただけで、古いセッションへの送信を止める。rustdsh は、慣れた既定の操作を変えるプラグイン(`ui-comfort` の Enter、`easy-work` の空のチャット)をスターターセットから外している(`rustdsh/plugins/recommended.md:57-64@b060ccf`、`rustdsh/plugins/install.sh:136-138@b060ccf`)。cache-sentinel もこれに当たる。2 にするなら、推奨経由で入れたときの既定のモードを `off` などにする必要があるが、#7 で既定は `block` のままと決めている。

### 2. 指定する版

1. **`github:AliceSaikawa/cache-sentinel`(main)**(おすすめ): sound・gitview と同じ形で、修正が rustdsh のリリースを待たずに届く。main の `lib/` は CI でビルド結果と照らしている。
2. `github:AliceSaikawa/cache-sentinel#v<版>` で固定する: 上記のとおり v0.6.0 は rustdsh の一部の版で拒否されるので、先に新しい版のリリースが要る。版を上げるたびに rustdsh 側の更新も要る。

1 を選ぶと、cache-sentinel の main を常に導入できる状態に保つ責任がこちらに残る。

### 3. headless に入ったときの扱い

`--recommended=all` や `--recommended=cache-sentinel` を `PROFILE=headless` で使うと、cache-sentinel は入るが起動しない(サービスを待ったままになり、エラーもログも出ない。README「対応バージョン・動作環境」)。

1. **そのままにし、表に web・desktop だけで動くと書く**(おすすめ): 実害がなく、変更が小さい。
2. 推奨の段でも、カタログの `profiles` で web・desktop 以外には入れないようにする: いま `profiles` を見るのは必須の段だけ(`rustdsh/src/plugins.rs:137-142@b060ccf`、`rustdsh/tests/plugin-catalog.test.mjs:59-71@b060ccf`)。`install.sh` と `src/plugins.rs` の `recommended_for` を変える必要があり、rustdsh の作りの変更になる。

### 4. `rdsh.json` の `features.*` で除外できるようにするか

1. **足さない**(おすすめ): 既定でオフなので、入るのは利用者が選んだときだけ。`features.*` は利用者の設定で、選ばれたプラグインを拒否するためのもの(`rustdsh/plugins/install.sh:218-220@b060ccf`)。いま `install.sh` でこの拒否を受ける推奨プラグインは、既定でオンの第三者プラグイン(sound・gitview)だけで、既定オフの `ui-comfort` などには無い(`rustdsh/plugins/install.sh:259-260@b060ccf`)。
2. `features.cache_sentinel` を足す: `--recommended=all` でも除外したい人向け。`src/rdsh_config.rs` の `FEATURES`(`:108`)、`install.sh` の `*_feature_allowed`、テストを足すことになる。

#17 本文のとおり、ここは rustdsh 側と相談する点として提案文に書く。

### 5. `src/desktop.rs`

変更しない(おすすめ)。`DEFAULT_THIRD_PARTY`(`rustdsh/src/desktop.rs:63@b060ccf`)は `rdsh desktop install` が既定で入れる一覧で、既定オフのものは入れない。Desktop には、`install.sh` の `PROFILE=desktop` の分岐が `--package` で渡し(下の差分)、`rdsh plugins install --profile desktop` もカタログで選んだものを `--package` で渡す(`rustdsh/src/plugins.rs:950-995@b060ccf`)。

## 変更案で確かめたこと

下の差分を、ローカルの rustdsh `b060ccf` に当てて確かめた。

- `node --test tests/plugin-catalog.test.mjs`: 5 件成功
- `DRY_RUN=1 sh plugins/install.sh`(`DSH_HOME` は空の一時ディレクトリ):
  - `PROFILE=web`(既定): cache-sentinel は入らない
  - `PROFILE=web` に `RECOMMENDED=cache-sentinel`・`CACHE_SENTINEL=1`・`RECOMMENDED=all` のどれか: `dsh plugin --profile web add github:AliceSaikawa/cache-sentinel` が出る
  - `PROFILE=headless`(既定): 入らない
  - `PROFILE=desktop RECOMMENDED=cache-sentinel`(`RDSH_BIN=true`): `rdsh desktop install` の引数に `--package github:AliceSaikawa/cache-sentinel` が入る。既定では入らない
- 確かめていないこと: cargo が無いので、rustdsh の Rust のテスト(`cargo test` など)と `tests/regress.sh` は実行していない。`--recommended=all` の件数を 9 と比べるテスト(`rustdsh/src/plugins.rs:1253-1256@b060ccf`)は、読んだうえで 10 に直した。ほかに件数や一覧を固定したテストが無いかは、`subagent-route` と `intelligent-ui` を grep して探しただけで、実行では確かめていない。rustdsh の PR には、CONTRIBUTING のテスト一式が要る。

## 提案文の下書き

rustdsh の CONTRIBUTING は英語を先に書く。Issue の feature の様式(Goal・Non-goals・Proposal・Fit check)に合わせた。

```markdown
### Goal
Offer cache-sentinel (https://github.com/AliceSaikawa/cache-sentinel, MIT) as an opt-in
recommended plugin, so web/desktop users can guard against sending to sessions whose
prompt cache has likely expired (uncached prompts are billed at the full rate).

### Non-goals
- Not part of the starter set or the essential tier: it is off by default, because it
  changes a familiar default (your next send to an idle session is stopped until `/unlock`).
- No change to the agent loop or profile boot.

### Proposal
- `plugins/install.sh`: new recommended id `cache-sentinel` (`CACHE_SENTINEL=1`),
  spec `github:AliceSaikawa/cache-sentinel`, off by default on every profile.
- `src/plugin_catalog.json`: the matching recommended entry (not `starter`).
- `plugins/recommended.md`: the id list, a row in the recommended table and in the third-party credits.
- `src/plugins.rs`: the test that counts `--recommended=all` goes from 9 to 10.
- `src/desktop.rs`: no change (`DEFAULT_THIRD_PARTY` stays as is; desktop gets it through `--package`).

Facts on the plugin side:
- Installs from `github:` without a build (built `lib/` is committed and checked in CI).
- Starts on profiles with `@deepseek-ai/dsh-web-app` (web, desktop). On headless it
  never starts and stays silent.
- Declares `peerDependencies` `@deepseek-ai/dsh >=0.2.0-rc.2 <=0.2.1-rc.5 || 0.2.2-alpha.2`,
  which covers 0.2.0-rc.2, 0.2.1-alpha.1/2/3, 0.2.1-rc.3/4 and 0.2.2-alpha.2.
- Blocks only steps started by the user's own send; job notices, subagents, goals and
  reminders (including rdsh-answer-guard) pass.

Questions for rustdsh:
- Should `features.cache_sentinel` be able to veto it (like sound/gitview), even under
  `--recommended=all`? Our suggestion is no, because it is opt-in.
- Should recommended entries honor `profiles`, so it is skipped on headless? Our
  suggestion is to keep the current behavior and document "web/desktop only".

### Fit check
- [x] Keeps the agent loop / profile boot in `dsh` (no reimplementation)
- [x] Includes acceptance criteria I can test

Acceptance criteria:
- `node --test tests/plugin-catalog.test.mjs` passes.
- `PROFILE=web DRY_RUN=1 ./plugins/install.sh` does not add cache-sentinel;
  with `--recommended=cache-sentinel` it prints `dsh plugin --profile web add github:AliceSaikawa/cache-sentinel`.
- On a web profile installed this way, a send to a session idle past `idleMinutes` is
  stopped with a notice in the conversation, the banner above the input box offers
  `/unlock`, and `/unlock` lets one send through.
```

## 付録: 差分(rustdsh `b060ccf` に対して)

```diff
diff --git a/plugins/install.sh b/plugins/install.sh
index 350f384..3dccf1c 100755
--- a/plugins/install.sh
+++ b/plugins/install.sh
@@ -39,7 +39,7 @@ UI_COMFORT="${UI_COMFORT:-0}"
 INTELLIGENT_UI="${INTELLIGENT_UI:-$BROWSER_PLUGINS_DEFAULT}"
 TRANSLATION="${TRANSLATION:-$BROWSER_PLUGINS_DEFAULT}"
 REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
-RECOMMENDED_IDS="translation compute easy-work subagents ui-comfort subagent-route sound gitview intelligent-ui"
+RECOMMENDED_IDS="translation compute easy-work subagents ui-comfort subagent-route sound gitview intelligent-ui cache-sentinel"
 
 usage() {
   cat <<EOF
@@ -52,6 +52,7 @@ Usage: [PROFILE=...] [DRY_RUN=1] ./plugins/install.sh [--recommended=SPEC] [--li
   --list                  alias for --recommended=list
   ids: $RECOMMENDED_IDS
 Env: PROFILE DRY_RUN SOUND GITVIEW COMPUTE EASY_WORK SUBAGENTS UI_COMFORT INTELLIGENT_UI TRANSLATION
+     CACHE_SENTINEL
      RECOMMENDED (same values as --recommended)
 EOF
 }
@@ -87,6 +88,7 @@ Recommended plugins (optional; choose with --recommended)
   compute         rdsh-compute                compute bridge
   easy-work       rdsh-easy-work              guided workflow entry points
   ui-comfort      rdsh-ui-comfort             deliberate Enter in the Web chat
+  cache-sentinel  github:AliceSaikawa/cache-sentinel  stop sends to sessions whose prompt cache likely expired (web/desktop)
 EOF
 }
 
@@ -129,18 +131,19 @@ rec_ui_comfort="$UI_COMFORT"
 rec_intelligent_ui="$INTELLIGENT_UI"
 rec_sound="$SOUND"
 rec_gitview="$GITVIEW"
+rec_cache_sentinel="${CACHE_SENTINEL:-0}"
 
 recommended_all() {
-  rec_translation=1; rec_compute=1; rec_easy_work=1; rec_subagents=1; rec_ui_comfort=1; rec_subagent_route=1; rec_intelligent_ui=1; rec_sound=1; rec_gitview=1
+  rec_translation=1; rec_compute=1; rec_easy_work=1; rec_subagents=1; rec_ui_comfort=1; rec_subagent_route=1; rec_intelligent_ui=1; rec_sound=1; rec_gitview=1; rec_cache_sentinel=1
 }
 # The beginner starter set: what a newcomer from Codex or Claude Code expects
 # without configuring anything. Plugins that change a familiar default (Enter
 # to send, the empty-chat preset picker) or need extra setup stay out of it.
 recommended_starter() {
-  rec_translation=1; rec_compute=0; rec_easy_work=0; rec_subagents=1; rec_ui_comfort=0; rec_intelligent_ui=1; rec_sound=1; rec_gitview=1
+  rec_translation=1; rec_compute=0; rec_easy_work=0; rec_subagents=1; rec_ui_comfort=0; rec_intelligent_ui=1; rec_sound=1; rec_gitview=1; rec_cache_sentinel=0
 }
 recommended_none() {
-  rec_translation=0; rec_compute=0; rec_easy_work=0; rec_subagents=0; rec_ui_comfort=0; rec_subagent_route=0; rec_intelligent_ui=0; rec_sound=0; rec_gitview=0
+  rec_translation=0; rec_compute=0; rec_easy_work=0; rec_subagents=0; rec_ui_comfort=0; rec_subagent_route=0; rec_intelligent_ui=0; rec_sound=0; rec_gitview=0; rec_cache_sentinel=0
 }
 
 apply_recommended_spec() {
@@ -161,6 +164,7 @@ apply_recommended_spec() {
           intelligent-ui|intelligent_ui|dsh-intelligent-ui) rec_intelligent_ui=1 ;;
           sound|dsh-sound-notifications) rec_sound=1 ;;
           gitview|dsh-gitview) rec_gitview=1 ;;
+          cache-sentinel|cache_sentinel) rec_cache_sentinel=1 ;;
           *)
             echo "plugins/install.sh: unknown recommended plugin '$_id' (ids: $RECOMMENDED_IDS)" >&2
             exit 2
@@ -192,13 +196,14 @@ select_recommended_individually() {
   if prompt_yes_no "github:cwd514/dsh-sound-notifications" "$rec_sound"; then rec_sound=1; else rec_sound=0; fi
   if prompt_yes_no "github:yugapor/dsh-gitview" "$rec_gitview"; then rec_gitview=1; else rec_gitview=0; fi
   if prompt_yes_no "dsh-intelligent-ui (visual answers)" "$rec_intelligent_ui"; then rec_intelligent_ui=1; else rec_intelligent_ui=0; fi
+  if prompt_yes_no "github:AliceSaikawa/cache-sentinel (stop sends after the prompt cache expires)" "$rec_cache_sentinel"; then rec_cache_sentinel=1; else rec_cache_sentinel=0; fi
 }
 
 prompt_recommended() {
   printf '\nRecommended plugins (optional):\n' >&2
   printf '  rdsh-translation, rdsh-compute, rdsh-easy-work, rdsh-subagent-optimizer,\n' >&2
   printf '  rdsh-ui-comfort, github:cwd514/dsh-sound-notifications, github:yugapor/dsh-gitview,\n' >&2
-  printf '  dsh-intelligent-ui\n' >&2
+  printf '  dsh-intelligent-ui, github:AliceSaikawa/cache-sentinel\n' >&2
   printf 'Install recommended plugins? [Y/n/a=all/s=select individually] ' >&2
   IFS= read -r _answer || _answer=""
   case "$_answer" in
@@ -319,6 +324,7 @@ if [ "$PROFILE" = "desktop" ]; then
     for p in $RECOMMENDED_BUNDLED; do echo "  [recommended] $REPO_ROOT/plugins/$p" >&2; done
     if [ "$rec_sound" = "1" ]; then echo "  [recommended] github:cwd514/dsh-sound-notifications" >&2; fi
     if [ "$rec_gitview" = "1" ]; then echo "  [recommended] github:yugapor/dsh-gitview" >&2; fi
+    if [ "$rec_cache_sentinel" = "1" ]; then echo "  [recommended] github:AliceSaikawa/cache-sentinel" >&2; fi
   
     exit 1
   fi
@@ -328,6 +334,7 @@ if [ "$PROFILE" = "desktop" ]; then
   for p in $RECOMMENDED_BUNDLED; do set -- "$@" --package "$REPO_ROOT/plugins/$p"; done
   if [ "$rec_sound" = "1" ]; then set -- "$@" --package github:cwd514/dsh-sound-notifications; fi
   if [ "$rec_gitview" = "1" ]; then set -- "$@" --package github:yugapor/dsh-gitview; fi
+  if [ "$rec_cache_sentinel" = "1" ]; then set -- "$@" --package github:AliceSaikawa/cache-sentinel; fi
 
   if [ "$DRY_RUN" = "1" ]; then
     printf '%s ' "$RDSH" desktop install "$@"
@@ -366,5 +373,8 @@ fi
 if [ "$rec_gitview" = "1" ]; then
   run_add github:yugapor/dsh-gitview "recommended third-party git panel"
 fi
+if [ "$rec_cache_sentinel" = "1" ]; then
+  run_add github:AliceSaikawa/cache-sentinel "recommended third-party prompt-cache guard"
+fi
 echo "done: $ok ok, $fail failed (profile: $PROFILE)"
 [ "$fail" -eq 0 ]
diff --git a/plugins/recommended.md b/plugins/recommended.md
index 8fc38cf..21f4c81 100644
--- a/plugins/recommended.md
+++ b/plugins/recommended.md
@@ -77,10 +77,10 @@ Choose a set explicitly (or for CI) with `--recommended`:
 | `id,id` | exactly the listed ids |
 
 Ids: `translation`, `compute`, `easy-work`, `subagents`, `ui-comfort`,
-`sound`, `gitview`, `intelligent-ui`. The `RECOMMENDED` environment variable
+`sound`, `gitview`, `intelligent-ui`, `cache-sentinel`. The `RECOMMENDED` environment variable
 carries the same value for callers that only set the environment. An explicit
 spec replaces the `TRANSLATION`, `COMPUTE`, `EASY_WORK`, `SUBAGENTS`,
-`UI_COMFORT`, `INTELLIGENT_UI`, `SOUND` and `GITVIEW` defaults;
+`UI_COMFORT`, `INTELLIGENT_UI`, `SOUND`, `GITVIEW` and `CACHE_SENTINEL` defaults;
 `features.sound=false` / `features.gitview=false` in `rdsh.json` still veto
 those two, even under `--recommended=all`.
 
@@ -146,6 +146,7 @@ check its duplicate-ID behavior before migrating existing profiles.
 | `sound` | `github:cwd514/dsh-sound-notifications` (MIT, (c) 2026 cwd514) | web, desktop | Effect sounds (Web Audio synthesis, no audio files) and desktop notifications for reply-done / approval-waiting / questions / errors / re-login. Zero dependencies, no build step. |
 | `gitview` | `github:yugapor/dsh-gitview` (MIT, (c) 2026 yugapor) | web, desktop | Git panel in the Web sidebar: working-tree changes, staging and commits, unified/side-by-side diffs, commit graph, branches, blame, reflog, and CI status. |
 | `intelligent-ui` | `dsh-intelligent-ui` (bundled; MIT, (c) 2026 cwd514) | web, desktop | ChatGPT-style visual answers: the model calls the declarative `render_ui` tool and the plugin draws the view (tables, charts, comparisons, timelines, inputs, calculators; 15 block types, nesting up to 6 levels). A browser client plugin, so `PROFILE=web` is the intended target; skip it with `INTELLIGENT_UI=0`. |
+| `cache-sentinel` | `github:AliceSaikawa/cache-sentinel` (MIT, (c) 2026 AliceSaikawa) | off | Guards against uncached prompts: once a session has been idle past the prompt-cache lifetime (60 min by default), it stops your next send there (the agent's own work keeps running) and offers `/unlock` for one more send; `/sentinel archive` instead archives idle sessions. Works on web and desktop profiles only; on `headless` it never starts. |
 
 Notes:
 
@@ -214,6 +215,7 @@ authors.
 | [dsh-sound-notifications](https://github.com/cwd514/dsh-sound-notifications) by cwd514 | MIT | Recommended `sound` plugin: effect sounds and desktop notifications. Default on for web/desktop; skip with `--recommended=none`, `SOUND=0`, or `features.sound=false`. |
 | [dsh-gitview](https://github.com/yugapor/dsh-gitview) by yugapor | MIT | Recommended `gitview` plugin: sidebar Git panel. Default on for web/desktop; skip with `--recommended=none`, `GITVIEW=0`, or `features.gitview=false`. |
 | [dsh-intelligent-ui](https://github.com/cwd514/dsh-intelligent-ui) by cwd514 | MIT | Recommended `intelligent-ui` plugin: `render_ui` visual answers in the DSH Web chat. Default on for web/desktop; skip with `--recommended=none`, `INTELLIGENT_UI=0`, or `rdsh desktop install --no-intelligent-ui`. |
+| [cache-sentinel](https://github.com/AliceSaikawa/cache-sentinel) by AliceSaikawa | MIT | Recommended `cache-sentinel` plugin: stops sends to sessions whose prompt cache likely expired. Off by default; add with `--recommended=cache-sentinel` or `CACHE_SENTINEL=1`. |
 
 ## Workflow board source preparation
 
diff --git a/src/plugin_catalog.json b/src/plugin_catalog.json
index 8d024b2..ad3b4a8 100644
--- a/src/plugin_catalog.json
+++ b/src/plugin_catalog.json
@@ -145,6 +145,11 @@
       "starter": true,
       "why": "interactive visual answers (render_ui), bundled",
       "bundled": true
+    },
+    {
+      "id": "cache-sentinel",
+      "package": "github:AliceSaikawa/cache-sentinel",
+      "why": "stop sends to sessions whose prompt cache likely expired (web/desktop)"
     }
   ]
 }
diff --git a/src/plugins.rs b/src/plugins.rs
index a09a4b4..99b1aac 100644
--- a/src/plugins.rs
+++ b/src/plugins.rs
@@ -1252,7 +1252,7 @@ mod tests {
         );
         assert_eq!(
             catalog.recommended_for("web", Some("all")).unwrap().len(),
-            9
+            10
         );
         assert!(catalog
             .recommended_for("web", Some("none"))
```
