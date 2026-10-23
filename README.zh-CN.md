# cache-sentinel

[English](README.md) | [日本語](README.ja.md) | 简体中文

DeepSeek Harness（DSH）插件，用于防止误向提示缓存（Prompt Cache）已过期的旧会话发送消息。

如果距上次响应已过去一段时间，直接在同一会话中继续发送消息，累积的全部对话历史都会按无缓存的常规输入价格计费。`cache-sentinel` 会监控距最后一次响应的经过时间，通过自动阻止向旧会话发送消息，或自动归档会话本身来防止误发送。

## 概述

针对已超过提示缓存有效时间的会话，本插件可通过以下 2 种方式防止误发送：

- **禁止输入（`block`）**：保持会话可打开和阅读，仅阻止你的发送。代理正在进行的工作（工具执行、作业、子代理、目标、提醒）不会被阻止。若希望继续发送，可通过输入框上方的按钮或 `/unlock` 命令仅允许下一次发送。
- **自动归档（`archive`）**：自动归档一段时间未更新的会话，将其从侧边栏隐藏并设为不可打开。

您可以随时在聊天输入框中通过 `/sentinel` 命令切换到结合两者的 `both` 模式（60 分钟后禁止输入，24 小时后归档），或暂时停用功能的 `off` 模式。

## 安装

1. 执行以下 1 条命令。

   ```sh
   dsh plugin --profile web add github:AliceSaikawa/cache-sentinel
   ```

   `web` 为示例，请指定您实际使用的配置文件（profile）名称。cache-sentinel 仅在包含 Web 应用的配置文件（如 `web`、`desktop`）中运行（请参阅[支持版本与运行环境](#支持版本与运行环境)）。

   此方式安装 `main` 的最新代码。如需固定版本，请在末尾以 `#v<版本>` 的形式附加标签（例如 `github:AliceSaikawa/cache-sentinel#v1.2.3`）。`v0.5.0` 及更早的标签不包含已构建的 `lib/`，无法用此方式安装。也可以指定 GitHub Release 中附带的 `cache-sentinel.tgz` 的 URL 进行安装。

2. 重启 DSH。

   插件代码会在 DSH 启动时加载，因此添加后需要重启。

   作为 systemd 用户服务运行时的示例：

   ```sh
   systemctl --user restart deepseek-harness
   ```

### 确认、更新与卸载

- **确认安装**：
  ```sh
  dsh plugin --profile web list cache-sentinel --depth 0
  ```
- **更新**：再次执行与安装相同的命令重新添加最新版本后，**请务必重启 DSH**（在重启前即使切换禁用→启用，进程内仍会继续使用旧代码）。
- **卸载**：
  ```sh
  dsh plugin --profile web remove cache-sentinel
  ```

## 使用方法

### 模式

| 模式 | 行为 |
|---|---|
| `block`（默认） | 距最后一次响应超过 `idleMinutes`（默认 60 分钟）后阻止用户的发送（仍可浏览）。不阻止代理正在进行的工作。用 `/unlock` 允许下 1 次发送 |
| `archive` | 距最后一次更新超过 `idleMinutes`（默认 60 分钟）后自动归档（从侧边栏隐藏且无法打开） |
| `both` | 距最后一次响应 `idleMinutes`（默认 60 分钟）后禁止输入，距最后一次更新 `archiveAfterMinutes`（默认 1440 分钟 = 24 小时）后自动归档 |
| `off` | 既不禁止输入也不归档（`/sentinel` 和 `/unlock` 命令仍可执行） |

### `/sentinel` 命令

可在聊天输入框中查看当前状态并切换模式。

- `/sentinel`：显示当前生效模式及其来源（通过 `/sentinel` 设置 / YAML 设置）、阈值、当前会话距最后一次响应的经过分钟数，以及 `dryRun` 状态。
- `/sentinel block` | `archive` | `both` | `off`：切换生效模式。保存在 `$DSH_HOME/cache-sentinel/state.json` 中，DSH 重启后依然保持（优先于 YAML 中的 `mode`）。
- `/sentinel default`：清除通过 `/sentinel` 保存的模式，恢复为 YAML 中的 `mode` 设置。

### `/unlock` 命令

- 在因禁止输入（`block` / `both` 模式）而过期的会话中执行 `/unlock`，会仅允许下 1 次发送。该许可在 `unlockTtlMinutes`（默认 10 分钟）后失效。
- 获得许可后只要返回 1 次模型响应（`step/end`），许可即完成使命，之后恢复常规判定（刚收到响应时尚未过期，因此可以自然地继续对话）。
- 在尚未过期的会话或尚无模型响应的会话中执行时，不会记录许可，仅显示当前经过时间或状态。

## UI 显示

- **显示语言**：界面文字跟随环境。Host 按 `LC_ALL`、`LC_MESSAGES`、`LANG`、系统区域设置的顺序判定，官方 Web UI 按浏览器语言（`navigator.languages`）判定。支持英语、日语和简体中文，未支持的语言回退为英语。日志输出（以 `[cache-sentinel]` 开头的行）仍为日语。
- **被阻止时（官方 Web UI 与 M3E 共通）**：
  - 会话内会以命令结果行的形式显示“已阻止发送(距最后一次响应 N 分钟，因为缓存很可能已过期)。”、“可用 /unlock 允许下 1 次发送。”，以及被丢弃的输入文本（每条最多 2000 字符）。该行位于轮次之外；在官方 Web UI 中，发送后无需展开折叠的轮次即可作为最顶层的行直接看到（M3E 中的显示效果尚未确认）。
  - 与用户发送进入同一步骤并一同被丢弃的其他输入（作业完成通知、插件的提醒等）不会显示面向模型的正文，而是显示来源附带的一行说明（`source.summary`），或“(来自 kind 的输入)”一行。
  - 重复发送相同输入而被连续阻止时，为避免通知堆积，每 10 分钟只显示 1 条（输入有变化或其间有发送成功时则立即显示）。阻止本身每次都会执行。
- **发送前的横幅显示**：
  - **官方 Web UI**：客户端插件（`lib/client.js`）会在输入框上方（`conversation.input.dock`）显示状态横幅。
    - 已过期：“缓存已过期(距最后一次响应 N 分钟)。直接发送将被阻止。”与“允许下 1 次发送(/unlock)”按钮
    - 允许中：“正允许下一次发送(将按无缓存价格计费)。剩余 M 分钟”
  - **M3E（`dsh-webui-m3e`）**：被阻止时的会话内通知行可以显示，但由于 M3E 不会加载其他插件的客户端包，发送前的横幅显示需要 M3E 侧的支持。
- **状态获取 API**：
  - `GET /api/cache-sentinel.status?sessionId=<id>`（带 Connection 认证）返回会话的状态 JSON。

## 设置

可在配置文件的 `cordis.patch.yml` 中修改设置。省略的项将使用默认值。

```yaml
- id: cache-sentinel
  config:
    mode: block               # block / archive / both / off (可用 /sentinel 覆盖)
    idleMinutes: 60           # 禁止输入的阈值(分钟)。archive 模式下为归档阈值(分钟)
    archiveAfterMinutes: 1440 # both 模式下的归档阈值(分钟)
    unlockTtlMinutes: 10      # /unlock 的有效时间(分钟)
    checkIntervalSeconds: 60  # 归档检查间隔(秒，10 以上)
    skipPinned: true          # 不归档已置顶的会话
    archiveExisting: false    # 将首次启用前就已停止更新的会话也纳入归档对象
    maxPerCycle: 20           # 每个周期的最大归档数量
    dryRun: false             # 为 true 时既不阻止也不归档，仅输出日志
    # stateFile: /path/to/state.json # 持久化状态文件路径(默认: $DSH_HOME/cache-sentinel/state.json)
```

- `cordis.patch.yml` 的设置修改无需重启 DSH 即可生效（插件会以新设置重新应用，内存中的 `/unlock` 许可会被清除）。
- 指定未知键名或类型、范围无效的值时会报错。

## 工作原理

### 禁止输入（`block` / `both` 模式）

- 在 `agent/pre-step` 钩子的最外层（`prepend: true`）于步骤开始前进行判定。由于在自动压缩（`dsh-compaction-basic`）之前判定，被阻止的步骤也不会因自动压缩而触发模型调用。
- 只阻止包含用户发送（`source.kind` 为 `user` 的消息）的轮次的第一个步骤。以下步骤即使缓存已过期也会放行，可能会在无缓存的情况下发送：
  - 同一轮次的第 2 个及之后的步骤（如轮次进行中到达的作业完成通知或插入发送）。工具执行后的后续步骤也属于此类，但最后响应时间会在工具结束时写入的 `step/end` 处更新，因此通常不会被判定为过期（参见[限制](#限制)）。
  - 不含用户发送而开始的轮次（后台作业完成通知、来自子代理的消息和完成通知、目标自动继续、提醒、webhook。webhook 仅存在于 DSH 0.2.0-rc.2）。
- 因上述原因放行已过期的步骤时，会在日志中记录原因（参见[查看日志](#查看日志)）。
- 如果用户发送与其他输入（如正在等待的作业完成通知）进入同一步骤，则整个步骤都会被阻止，该输入也会被丢弃。
- 经过时间根据会话最后一次 `step/end` 事件的时间戳（包含从分叉继承的历史）计算。尚无模型响应的新会话，或经过时间恰好在 `idleMinutes` 分钟以内的会话会直接放行。
- 拒绝步骤时不会发出 API 请求，也不会产生费用。**原本准备进入该步骤的发送消息会被丢弃**，请在解除后重新输入（被丢弃的文本会显示在会话内的阻止通知中）。

### 归档（`archive` / `both` 模式）

- 在插件启用时以及之后每隔 `checkIntervalSeconds` 秒检查一次会话列表。
- 最后更新时间（`lastActivityAt`）取会话日志文件（`session.v*.jsonl[.zstd]`）的 `mtime`、已加载会话末尾事件的时间戳、手动取消归档的时间戳中的最大值（若均无则取创建时间）。
- 在首次启用归档模式的基准时间（`baselineAt`）之前就已停止更新的会话，默认不会归档（设置 `archiveExisting: true` 可将其纳入对象）。
- 已置顶的会话（当 `skipPinned: true` 时）、子代理会话，以及有正在执行的工作（轮次、作业、子代理、提醒）的会话不在对象范围内。
- 手动取消归档的会话，从检测到取消归档的时刻起会再次获得阈值时长的宽限期。

## 限制

- 由于 M3E 不会加载其他插件的客户端包，发送前的横幅显示需要 M3E 侧的支持（被阻止时的会话内通知仅靠 Host 侧即可显示）。
- 在子代理会话中，无法从 GUI 执行 `/unlock`。来自父代理的消息不会被阻止，但从 GUI 直接发送给子代理的消息，在子代理一侧缓存已过期时会被阻止。
- 即使由用户操作产生，非普通发送的输入也不会被阻止：
  - 通过 `/goal <目标>` 创建目标、通过 `/goal edit` 编辑目标、恢复目标。即使缓存已过期，目标也会运行。
  - 带附件的 `/goal`。附件会作为普通发送先进入，因此会被阻止并丢弃，目标将在没有附件的情况下运行（根据代码得出的行为，未在实际环境中确认）。
  - 缓存过期后对提问（`ask_user_question`）的回答。如果阻止，回答会被丢弃。问题会恢复为等待回答的状态，但用户以为已经回答过，很难意识到需要重新回答。
- 超过 `idleMinutes` 的工具执行之后的后续步骤会在无缓存的情况下发送，但插件不会检测到（也不会记录日志）。这是因为最后响应时间会在工具结束时写入的 `step/end` 处更新。
- 标题自动生成（`session-title-first-prompt-llm`）会在首次发送时独立调用模型，不在门控对象范围内（仅限新会话或分叉的首次发送，且只发送第一条消息）。
- 提示缓存的实际寿命取决于提供方和请求内容。本插件仅根据经过时间进行近似判定。

## 故障排查

### 更新插件后请重启 DSH

使用 `dsh plugin --profile web add ...` 重新添加新版本后，请在启用插件或修改设置之前**重启 DSH**。如果不重启而只是切换插件的禁用→启用，仍会复用进程内残留的旧模块。

### 查看日志

启动、阻止、虽已过期但仍放行的步骤、`/unlock` 许可、模式变更和归档均会带 `[cache-sentinel]` 前缀输出到标准输出 / 标准错误以及 DSH 的日志器中。

作为 systemd 用户服务（`deepseek-harness`）运行时的日志查看示例：

```sh
journalctl --user -u deepseek-harness | grep cache-sentinel
```

## 开发

```sh
pnpm test          # 单元测试 (node --test)
pnpm run typecheck # 类型检查 (tsc --noEmit)
pnpm run build     # 构建 (lib/index.js, lib/client.js)
```

通过 `github:` 安装时不会进行构建，因此仓库中也包含已构建的 `lib/`。修改 `src/` 后，请执行 `pnpm run build` 并一并提交 `lib/`。

推送到 `main` 和 pull request 时，CI（`.github/workflows/ci.yml`）会在 Linux 和 Windows 上执行相同的三条命令，并检查已提交的 `lib/` 与构建结果一致。发布通过推送 `v*` 标签进行（`.github/workflows/release.yml`）：标签名必须与 `package.json` 的 `version` 一致，否则会失败，构建出的 `cache-sentinel.tgz` 会附加到 GitHub Release。

从源码构建并安装本地 `.tgz` 时：

```sh
git clone https://github.com/AliceSaikawa/cache-sentinel.git
cd cache-sentinel
pnpm install
pnpm run build
pnpm pack
dsh plugin --profile web add file:$PWD/cache-sentinel-$(node -p "require('./package.json').version").tgz
```

`scripts/dsh-rpc.mjs` 是在将 DSH 作为 `deepseek-harness` 用户 systemd 服务运行的环境中，从 journal 的启动 URL 获取令牌并直接调用 DSH RPC 的验证脚本。

```sh
node scripts/dsh-rpc.mjs workspace/unarchiveSession '{"sessionId":"..."}'
node scripts/dsh-rpc.mjs --args commands/execute '{"agentId":"<sessionId>","line":"/unlock","submittedAttachments":[]}'
```

`scripts/dsh-compat.ts` 用于检查 cache-sentinel 所使用的 `@deepseek-ai/*` 各包是否因 DSH 版本而变化。发布新的 DSH 版本时，它会将各包与已确认的版本进行比较，并报告 `same`（无变化，预计兼容）/ `diff`（有变化，需要人工阅读差异）/ `missing`（获取失败）。

```sh
node scripts/dsh-compat.ts /var/tmp/dsh-compat 0.2.1-rc.1 0.2.1-rc.2
```

同样的检查也可以在 GitHub Actions 上运行（`.github/workflows/dsh-compat.yml`）。在 Actions > DSH compat > Run workflow 中指定基准版本和要比较的版本（以空格分隔）即可启动。`next` 等 dist-tag 会解析为 `@deepseek-ai/dsh` 的版本。结果显示在作业摘要中。只有出现 `missing` 时作业才会失败；`diff` 仍需人工阅读判断。修改该脚本或工作流的 pull request 会自动以固定的版本组合（`0.2.1-rc.1` 与 `0.2.1-alpha.5`）运行。

设计、规格与调研详情请参阅 [docs/](docs/README.md)（`docs/` 下的文档均为日语）。

- [docs/spec.md](docs/spec.md)：总体规格（模式切换与禁止输入）
- [docs/spec-ui.md](docs/spec-ui.md)：UI 显示与状态 API 规格
- [docs/archive-spec.md](docs/archive-spec.md)：归档模式规格
- [docs/spike.md](docs/spike.md)：DSH 内部 API 调研记录

## 支持版本与运行环境

- **DeepSeek Harness（DSH）**：**0.2.0-rc.2 ～ 0.2.1-rc.1**（包含 0.2.1-alpha.1～alpha.5）
  - **0.2.0-rc.2**：已在真实环境确认。
  - **0.2.1-alpha.1～alpha.5、0.2.1-rc.1**：已将 cache-sentinel 使用的 API 的类型定义与实现同 0.2.0-rc.2 进行比较确认（2026-10-17）。未在真实环境确认。在 0.2.1-rc.1 中，来自浏览器以外的连接端的状态获取 API 会返回 403（该连接端仅是发送前横幅不显示）。
  - 依据请参阅 [docs/spike.md](docs/spike.md)。确认新版本时可使用 [scripts/dsh-compat.ts](scripts/dsh-compat.ts)。
- **DSH 配置文件**：`web` 和 `desktop`，即 `dsh.profile.bundles` 中包含 `@deepseek-ai/dsh-web-app` 的配置文件（由 `web` 模板创建的配置文件也包括在内）。cache-sentinel 需要 `workspaceRegistry` 和 `connection` 服务，而只有该 bundle 提供这两项服务。
  - 在 `headless`、`acp` 等其他配置文件中，cache-sentinel 不会启动。它会一直等待这些服务，因此输入阻止、归档、`/sentinel`、`/unlock` 均不可用。不会报错，也不会输出 `[cache-sentinel]` 的启动日志。
  - `desktop` 与 `web` 使用相同的 bundle，但尚未在真实环境确认。npm 版 `dsh` CLI 不接受 `desktop` 配置文件的插件管理，请使用随 Desktop 应用安装的 `dsh` 命令添加。
- **Node.js / pnpm**：标准 DSH CLI 在添加插件时会使用 `PATH` 上的 `pnpm`（通过 `github:` 或 Releases 的 `.tgz` 安装时，用户侧无需构建）

## 许可证

MIT License — 请参阅 [LICENSE](LICENSE)。
