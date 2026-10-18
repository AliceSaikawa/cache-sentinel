# cache-sentinel

English | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

A plugin for DeepSeek Harness (DSH) that prevents accidental sends to old sessions whose prompt cache has expired.

If you send a follow-up message to a session where some time has passed since the last response, the entire accumulated conversation history is billed at the regular uncached input rate. `cache-sentinel` monitors the time elapsed since the last response and prevents accidental sends by automatically blocking sends to old sessions or automatically archiving the sessions themselves.

## Overview

For sessions where the prompt cache lifetime has passed, this plugin prevents accidental sends in two ways:

- **Input blocking (`block`)**: Keeps the session open and readable while stopping only sends that call the model. When you want to continue sending, you can allow just the next send using the button above the input box or the `/unlock` command.
- **Auto-archiving (`archive`)**: Automatically archives sessions that have not been updated for a while, hiding them from the sidebar so they cannot be opened.

You can switch at any time from the chat `/sentinel` command to `both` mode, which combines both (input blocking after 60 minutes, archiving after 24 hours), or `off` mode, which temporarily disables the feature.

## Installation

1. Run the following single command.

   ```sh
   dsh plugin --profile web add github:AliceSaikawa/cache-sentinel
   ```

   `web` is an example. Specify the profile name you actually use. cache-sentinel works only in profiles that include the Web app, such as `web` and `desktop` (see [Supported Versions and Environment](#supported-versions-and-environment)).

   This installs the latest `main`. To pin a version, append a tag as `#v<version>` (for example, `github:AliceSaikawa/cache-sentinel#v1.2.3`). Tags up to and including `v0.5.0` do not contain the built `lib/`, so they cannot be installed this way. You can also install by giving the URL of the `cache-sentinel.tgz` attached to a GitHub Release.

2. Restart DSH.

   Plugin code is loaded when DSH starts, so a restart is required after adding it.

   Example when running DSH as a systemd user service:

   ```sh
   systemctl --user restart deepseek-harness
   ```

### Check, Update, and Remove

- **Check installation**:
  ```sh
  dsh plugin --profile web list cache-sentinel --depth 0
  ```
- **Update**: Run the same installation command again to re-add the latest version, and then **be sure to restart DSH** (toggling the plugin off and on before restarting will continue to use the old code loaded in the process).
- **Remove**:
  ```sh
  dsh plugin --profile web remove cache-sentinel
  ```

## Usage

### Modes

| Mode | Behavior |
|---|---|
| `block` (default) | Blocks input once `idleMinutes` (default: 60 minutes) have passed since the last response (viewing is still allowed). `/unlock` allows the next single send |
| `archive` | Automatically archives the session once `idleMinutes` (default: 60 minutes) have passed since the last update (hidden from the sidebar and cannot be opened) |
| `both` | Blocks input `idleMinutes` (default: 60 minutes) after the last response, and automatically archives `archiveAfterMinutes` (default: 1440 minutes = 24 hours) after the last update |
| `off` | Neither blocks input nor archives sessions (`/sentinel` and `/unlock` commands remain available) |

### `/sentinel` Command

You can check the current status and switch modes from the chat input box.

- `/sentinel`: Shows the current effective mode and its source (set via `/sentinel` / set in YAML), thresholds, elapsed minutes since the last response in this session, and `dryRun` status.
- `/sentinel block` | `archive` | `both` | `off`: Switches the effective mode. It is saved to `$DSH_HOME/cache-sentinel/state.json` and preserved across DSH restarts (takes precedence over `mode` in YAML).
- `/sentinel default`: Clears the mode saved via `/sentinel` and reverts to the `mode` setting in YAML.

### `/unlock` Command

- Running `/unlock` in an expired session under input blocking (`block` / `both` mode) allows just the next send once. The permission expires after `unlockTtlMinutes` (default: 10 minutes).
- Once a model response (`step/end`) returns after unlocking, the permission has served its purpose and normal checks resume (since the session is not expired right after a response, you can continue the conversation naturally).
- Running it in a session that has not expired yet or has no model response yet does not record a permission and only displays the current elapsed time or status.

## UI Display

- **Display language**: Text follows your environment. The Host resolves it from `LC_ALL`, `LC_MESSAGES`, `LANG`, and the system locale, in that order; the official Web UI resolves it from the browser language (`navigator.languages`). English, Japanese, and Simplified Chinese are supported, and unsupported languages fall back to English. Log output (lines prefixed with `[cache-sentinel]`) stays in Japanese.
- **When a send is blocked (both the official Web UI and M3E)**:
  - The conversation displays "Send blocked (N minutes since the last response, as the cache has likely expired)." and "You can allow the next single send with /unlock.", along with the discarded input text (up to 2000 characters per message), as a command result line.
  - When steps with 0 input messages (such as automatic continuation) are rejected consecutively, notifications are throttled to at most once every 10 minutes per session.
- **Pre-send banner display**:
  - **Official Web UI**: The client plugin (`lib/client.js`) displays a status banner above the input box (`conversation.input.dock`).
    - Expired: "Cache expired (N minutes since the last response). Sending now will be blocked." and the "Allow the next single send (/unlock)" button
    - Unlocked: "Next send allowed (uncached input rates will apply). M min left"
  - **M3E (`dsh-webui-m3e`)**: The conversation line when blocked is displayed, but because M3E does not load client bundles from other plugins, displaying the pre-send banner requires support on the M3E side.
- **Status API**:
  - `GET /api/cache-sentinel.status?sessionId=<id>` (with Connection authentication) returns the session status JSON.

## Configuration

You can change the settings in your profile's `cordis.patch.yml`. Omitted keys use their default values.

```yaml
- id: cache-sentinel
  config:
    mode: block               # block / archive / both / off (can be overridden with /sentinel)
    idleMinutes: 60           # threshold for input blocking (min); in archive mode, the archive threshold (min)
    archiveAfterMinutes: 1440 # archive threshold in both mode (min)
    unlockTtlMinutes: 10      # how long /unlock stays valid (min)
    checkIntervalSeconds: 60  # archive check interval (sec, 10 or more)
    skipPinned: true          # do not archive pinned sessions
    archiveExisting: false    # also archive sessions that have been idle since before archiving was first enabled
    maxPerCycle: 20           # maximum sessions to archive per cycle
    dryRun: false             # when true, neither block nor archive, only log
    # stateFile: /path/to/state.json # path to persistent state file (default: $DSH_HOME/cache-sentinel/state.json)
```

- Changes to `cordis.patch.yml` take effect without restarting DSH (the plugin is re-applied with the new settings, and in-memory `/unlock` permissions are cleared).
- Specifying unknown keys or values with invalid types or ranges results in an error.

## How It Works

### Input Blocking (`block` / `both` Mode)

- Evaluates before a step starts at the head of the `agent/pre-step` hook (`prepend: true`). Because it runs before automatic compaction (`dsh-compaction-basic`), model calls for automatic compaction do not occur in expired sessions either.
- Blocks steps regardless of where the message came from: user sends, reminders, automatic goal continuation, background job completion notifications, subagent continuation, and next steps after long tool executions are all covered.
- Elapsed time is calculated from the timestamp of the session's last `step/end` event (including history inherited from a fork). New sessions with no model response yet, or sessions whose elapsed time is within `idleMinutes` minutes (inclusive), are allowed through.
- When a step is rejected, no API request is made and no charges are incurred. **The outgoing message that was about to enter that step is discarded**, so please type it again after unlocking (the discarded text is shown in the block notice inside the conversation).

### Archiving (`archive` / `both` Mode)

- Checks the session list when the plugin is enabled and every `checkIntervalSeconds` seconds thereafter.
- The last update time (`lastActivityAt`) is the maximum of the session log file (`session.v*.jsonl[.zstd]`) `mtime`, the timestamp of the last event in a loaded session, and the timestamp when the session was manually unarchived (or the creation time if none are available).
- Sessions that stopped updating before the baseline timestamp (`baselineAt`) when an archiving mode was first enabled are not archived by default (set `archiveExisting: true` to include them).
- Pinned sessions (when `skipPinned: true`), subagent sessions, and sessions with running work (turns, jobs, subagents, reminders) are excluded.
- Sessions that are manually unarchived get another grace period of the threshold duration from the time the unarchiving is detected.

## Limitations

- Because M3E does not load client bundles from other plugins, displaying the pre-send banner requires support on the M3E side (the in-conversation notice when blocked is displayed by the Host side alone).
- In subagent sessions, `/unlock` cannot be executed from the GUI.
- Automatic title generation (`session-title-first-prompt-llm`) calls the model independently on the first send and is outside the gate (only on the first send in new sessions or forks, and only the first message is sent).
- The actual prompt cache lifetime depends on the provider and request contents. This plugin is an approximation based solely on elapsed time.

## Troubleshooting

### Restart DSH After Updating the Plugin

After re-adding a new version with `dsh plugin --profile web add ...`, **restart DSH** before enabling the plugin or changing its settings. Toggling the plugin off and on without restarting will reuse the old module remaining in the process.

### Viewing Logs

Startup, blocks, `/unlock` grants, mode changes, and archiving are output with a `[cache-sentinel]` prefix to stdout / stderr and the DSH logger.

Example for checking logs when running DSH as a systemd user service (`deepseek-harness`):

```sh
journalctl --user -u deepseek-harness | grep cache-sentinel
```

## Development

```sh
pnpm test          # unit tests (node --test)
pnpm run typecheck # type check (tsc --noEmit)
pnpm run build     # build (lib/index.js, lib/client.js)
```

Installing with `github:` does not build anything, so the built `lib/` is committed to the repository. When you change `src/`, run `pnpm run build` and commit `lib/` as well.

CI (`.github/workflows/ci.yml`) runs the same three commands on Linux and Windows for every push to `main` and every pull request, and also checks that the committed `lib/` matches the build output. Releases come from `.github/workflows/release.yml` on a `v*` tag push: the tag must match the `version` in `package.json`, and the built `cache-sentinel.tgz` is attached to the GitHub Release.

To build from source and install a local `.tgz`:

```sh
git clone https://github.com/AliceSaikawa/cache-sentinel.git
cd cache-sentinel
pnpm install
pnpm run build
pnpm pack
dsh plugin --profile web add file:$PWD/cache-sentinel-$(node -p "require('./package.json').version").tgz
```

`scripts/dsh-rpc.mjs` is a verification script for environments running DSH as the `deepseek-harness` user systemd service; it retrieves the token from the startup URL in the journal and calls DSH RPCs directly.

```sh
node scripts/dsh-rpc.mjs workspace/unarchiveSession '{"sessionId":"..."}'
node scripts/dsh-rpc.mjs --args commands/execute '{"agentId":"<sessionId>","line":"/unlock","submittedAttachments":[]}'
```

`scripts/dsh-compat.ts` checks whether the `@deepseek-ai/*` packages that cache-sentinel uses have changed between DSH versions. When a new DSH version is released, it compares each package against the verified version and reports `same` (no change, so it should stay compatible) / `diff` (files changed, so a human should read the diff) / `missing` (fetch failed).

```sh
node scripts/dsh-compat.ts /var/tmp/dsh-compat 0.2.1-rc.1 0.2.1-rc.2
```

The same check runs on GitHub Actions (`.github/workflows/dsh-compat.yml`). Start it from Actions > DSH compat > Run workflow, with the base version and the versions to check (space-separated). Dist-tags such as `next` are resolved to the version of `@deepseek-ai/dsh`. The result appears in the job summary. The job fails only on `missing`; a `diff` still needs a human to read it. On pull requests that change the script or the workflow, it runs automatically on a pinned pair (`0.2.1-rc.1` and `0.2.1-alpha.5`).

See [docs/](docs/README.md) for design, specifications, and investigation details (all documents under `docs/` are in Japanese).

- [docs/spec.md](docs/spec.md): Overall specification (mode switching and input blocking)
- [docs/spec-ui.md](docs/spec-ui.md): UI display and status API specification
- [docs/archive-spec.md](docs/archive-spec.md): Archive mode specification
- [docs/spike.md](docs/spike.md): Investigation notes on DSH internal APIs

## Supported Versions and Environment

- **DeepSeek Harness (DSH)**: **0.2.0-rc.2 to 0.2.1-rc.1** (including 0.2.1-alpha.1 to alpha.5)
  - **0.2.0-rc.2**: verified on a real environment.
  - **0.2.1-alpha.1 to alpha.5 and 0.2.1-rc.1**: the type definitions and implementations of the APIs that cache-sentinel uses were compared against 0.2.0-rc.2 (2026-10-17). Not verified on a real environment. In 0.2.1-rc.1, the status API returns 403 for connections other than the browser (in that case the pre-send banner is simply not shown).
  - See [docs/spike.md](docs/spike.md) for the evidence. To check a newer version, run [scripts/dsh-compat.ts](scripts/dsh-compat.ts).
- **DSH profiles**: `web` and `desktop`, that is, profiles whose `dsh.profile.bundles` includes `@deepseek-ai/dsh-web-app` (custom profiles created from the `web` template also qualify). cache-sentinel requires the `workspaceRegistry` and `connection` services, which only that bundle provides.
  - In other profiles such as `headless` and `acp`, cache-sentinel does not start. It keeps waiting for those services, so input blocking, archiving, `/sentinel`, and `/unlock` are all unavailable. No error is reported, and the `[cache-sentinel]` startup log line does not appear.
  - `desktop` uses the same bundle as `web` but has not been verified on a real environment. The npm `dsh` CLI rejects plugin management for the `desktop` profile, so add the plugin with the `dsh` command installed with the Desktop app.
- **Node.js / pnpm**: The standard DSH CLI uses `pnpm` on `PATH` when adding plugins (when installing with `github:` or from the Releases `.tgz`, no build is needed on the user side)

## License

MIT License — see [LICENSE](LICENSE).
