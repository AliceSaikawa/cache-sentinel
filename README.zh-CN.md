# cache-sentinel

[English](README.md) | [日本語](README.ja.md) | 简体中文

DeepSeek Harness（DSH）插件，用于防止误向提示缓存（Prompt Cache）已过期的旧会话发送消息。

如果距上次响应已过去一段时间，直接在同一会话中继续发送消息，累积的全部对话历史都会按无缓存的常规输入价格计费。`cache-sentinel` 会监控距最后一次响应的经过时间，通过自动阻止向旧会话发送消息，或自动归档会话本身来防止误发送。

## 概述

针对已超过提示缓存有效时间的会话，本插件可通过以下 2 种方式防止误发送：

- **禁止输入（`block`）**：保持会话可打开和阅读，仅阻止调用模型的发送操作。若希望继续发送，可通过输入框上方的按钮或 `/unlock` 命令仅允许下一次发送。
- **自动归档（`archive`）**：自动归档一段时间未更新的会话，将其从侧边栏隐藏并设为不可打开。

您可以随时在聊天输入框中通过 `/sentinel` 命令切换到结合两者的 `both` 模式（60 分钟后禁止输入，24 小时后归档），或暂时停用功能的 `off` 模式。

## 安装

1. 执行以下 1 条命令。

   ```sh
   dsh plugin --profile web add https://github.com/AliceSaikawa/cache-sentinel/releases/latest/download/cache-sentinel.tgz
   ```

   `web` 为示例，请指定您实际使用的配置文件（profile）名称。

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
| `block`（默认） | 距最后一次响应超过 `idleMinutes`（默认 60 分钟）后禁止输入（仍可浏览）。用 `/unlock` 允许下 1 次发送 |
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

- **被阻止时（官方 Web UI 与 M3E 共通）**：
  - 会话内会以命令结果行的形式显示“送信を止めました(最終応答から N 分。キャッシュが切れている可能性が高いため)。”（“已阻止发送(距最后一次响应 N 分钟，因为缓存很可能已过期)。”）、“/unlock で次の 1 回を許可できます。”（“可用 /unlock 允许下 1 次发送。”），以及被丢弃的输入文本（每条最多 2000 字符）。
  - 当输入消息为 0 条的步骤（如自动继续）被连续拒绝时，同一会话内的通知会抑制为最多每 10 分钟 1 次。
- **发送前的横幅显示**：
  - **官方 Web UI**：客户端插件（`lib/client.js`）会在输入框上方（`conversation.input.dock`）显示状态横幅。
    - 已过期：“キャッシュ切れ(最終応答から N 分)。このまま送ると止められます。”（“缓存已过期(距最后一次响应 N 分钟)。直接发送将被阻止。”）与“次の 1 回を許可(/unlock)”（“允许下 1 次发送(/unlock)”）按钮
    - 允许中：“次の送信を許可中(キャッシュなしの料金になります)。あと M 分”（“正允许下一次发送(将按无缓存价格计费)。剩余 M 分钟”）
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

- 在 `agent/pre-step` 钩子的最外层（`prepend: true`）于步骤开始前进行判定。由于在自动压缩（`dsh-compaction-basic`）之前判定，缓存已过期的会话中也不会因自动压缩而触发模型调用。
- 阻止对象不限消息来源：用户发送、提醒、目标自动继续、后台作业完成通知、子代理继续，以及长时间工具执行后的下一步骤均在对象范围内。
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
- 在子代理会话中，无法从 GUI 执行 `/unlock`。
- 标题自动生成（`session-title-first-prompt-llm`）会在首次发送时独立调用模型，不在门控对象范围内（仅限新会话或分叉的首次发送，且只发送第一条消息）。
- 提示缓存的实际寿命取决于提供方和请求内容。本插件仅根据经过时间进行近似判定。

## 故障排查

### 更新插件后请重启 DSH

使用 `dsh plugin --profile web add ...` 重新添加新版本后，请在启用插件或修改设置之前**重启 DSH**。如果不重启而只是切换插件的禁用→启用，仍会复用进程内残留的旧模块。

### 查看日志

启动、阻止、`/unlock` 许可、模式变更和归档均会带 `[cache-sentinel]` 前缀输出到标准输出 / 标准错误以及 DSH 的日志器中。

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
- **Node.js / pnpm**：标准 DSH CLI 在添加插件时会使用 `PATH` 上的 `pnpm`（通过 Releases 的 `.tgz` 安装时，用户侧无需获取源码或构建）

## 许可证

MIT License — 请参阅 [LICENSE](LICENSE)。
