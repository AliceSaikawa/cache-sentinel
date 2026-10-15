/**
 * cache-sentinel — Host half(spec v0.4: モード切り替え)。
 * - block: 最終応答から idleMinutes を超えたセッションの送信を拒否(src/block.ts)。`/unlock` で 1 回許可。
 * - archive: idleMinutes を超えたセッションを自動アーカイブ(src/archive.ts, src/cycle.ts)。
 * - both: idleMinutes で入力禁止、archiveAfterMinutes でアーカイブ。
 * - off: 何もしない。
 * 実効モードは `/sentinel` で変えられ、state.json に保存される(なければ YAML の mode)。
 * DSH 本体は依存ではないため、使うサービスの形は最小限をここに書き写す(根拠は docs/spike.md)。
 */
import { join } from 'node:path'
import { scanLogMtimes } from './activity.ts'
import { createDeps, resolveHome, type ArchiveServices } from './archive.ts'
import {
  createSentinel,
  type AgentLike,
  type CommandResult,
  type PreStepDecision,
  type PreStepPayload,
  type SessionLike,
} from './block.ts'
import { parseConfig, type Config } from './config.ts'
import { runCycle, type CycleDeps } from './cycle.ts'
import type { TimedEvent } from './last-response.ts'
import { createLogger, type Logger } from './log.ts'
import {
  archives,
  archiveThresholdMinutes,
  blocks,
  effectiveMode,
  parseSentinelArgs,
  statusMessage,
  unlockInactiveMessage,
  usageMessage,
} from './mode.ts'
import type { Mode } from './modes.ts'
import { loadState, saveState, type State } from './state.ts'

export const name = 'cache-sentinel'
export const inject = ['commands', 'workspaceRegistry', 'sessionPersistence', 'sessions', 'timer']

/** ctx のうち使う部分。 */
export interface HostContext extends ArchiveServices {
  on(
    name: 'agent/pre-step',
    listener: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
    options: { prepend: boolean },
  ): () => boolean
  on(name: 'session/event', listener: (session: SessionLike, event: TimedEvent) => void): () => boolean
  commands: {
    register(definition: {
      name: string
      description: string
      handler: (invocation: { agent: AgentLike; rawInput: string }) => CommandResult | Promise<CommandResult>
    }): () => void
  }
  interval(callback: () => void, delayMs: number): () => void
  logger: Logger
}

/** 永続化と時計。テストで差し替える。 */
export interface RuntimeIO {
  now(): number
  save(state: State): Promise<void>
}

/** モード・入力禁止・アーカイブをまとめた実行時の部品。ctx なしでテストできる。 */
export interface Runtime {
  mode(): Mode
  onPreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
  onSessionEvent(session: SessionLike, event: TimedEvent): void
  unlock(agent: AgentLike): CommandResult
  sentinel(agent: AgentLike, rawInput: string): Promise<CommandResult>
  /** アーカイブの 1 サイクル。モードがアーカイブしないときは何もしない。前のサイクル実行中なら飛ばす。 */
  tick(): Promise<void>
}

export function createRuntime(
  config: Config,
  initialState: State,
  cycleDeps: CycleDeps,
  log: Logger,
  io: RuntimeIO,
): Runtime {
  let state = initialState
  let prevArchived: ReadonlySet<string> | undefined
  let running = false
  let writes: Promise<void> = Promise.resolve()

  const current = () => effectiveMode(state.mode, config.mode)
  const persist = (): Promise<void> => {
    const snapshot = state
    writes = writes
      .then(() => io.save(snapshot))
      .catch((error) => log.warn(`state.json の保存に失敗しました: ${String(error)}`))
    return writes
  }
  /** アーカイブが初めて有効になったら基準時刻を記録する(spec §B)。 */
  const ensureBaseline = (mode: Mode): boolean => {
    if (!archives(mode) || state.baselineAt !== undefined) return false
    state = { ...state, baselineAt: io.now() }
    return true
  }

  const block = createSentinel(config, log, io.now, () => blocks(current().mode))

  const runtime: Runtime = {
    mode: () => current().mode,
    onPreStep: (payload, next) => block.onPreStep(payload, next),
    onSessionEvent: (session, event) => block.onSessionEvent(session, event),
    unlock: (agent) => block.unlock(agent, unlockInactiveMessage(current().mode)),

    async sentinel(agent, rawInput) {
      const command = parseSentinelArgs(rawInput)
      if (command.kind === 'invalid') return { kind: 'error', text: usageMessage() }
      if (command.kind === 'set' || command.kind === 'default') {
        const before = current().mode
        if (command.kind === 'set') {
          state = { ...state, mode: command.mode }
        } else {
          const { mode: _dropped, ...rest } = state
          state = rest
        }
        const after = current().mode
        ensureBaseline(after)
        await persist()
        log.info(`モードを変更しました: ${before} → ${after}(${command.kind === 'set' ? '/sentinel' : 'YAML に戻す'})`)
        if (archives(after) && !archives(before)) {
          prevArchived = undefined
          void runtime.tick()
        }
      }
      const { mode, source } = current()
      return {
        kind: 'success',
        text: statusMessage({
          mode,
          source,
          configMode: config.mode,
          idleMinutes: config.idleMinutes,
          archiveAfterMinutes: config.archiveAfterMinutes,
          unlockTtlMinutes: config.unlockTtlMinutes,
          dryRun: config.dryRun,
          sessionIdleMinutes: block.idleMinutesOf(agent.session),
        }),
      }
    },

    async tick() {
      if (running) return // 前のサイクルが終わっていなければ飛ばす
      running = true
      try {
        const mode = current().mode
        const threshold = archiveThresholdMinutes(mode, config)
        if (threshold === undefined) {
          prevArchived = undefined // 再び有効になったときの初回は解除の検出をしない
          return
        }
        if (ensureBaseline(mode)) await persist()
        const result = await runCycle(
          cycleDeps,
          {
            thresholdMinutes: threshold,
            skipPinned: config.skipPinned,
            archiveExisting: config.archiveExisting,
            maxPerCycle: config.maxPerCycle,
            dryRun: config.dryRun,
          },
          { baselineAt: state.baselineAt ?? io.now(), unarchivedAt: state.unarchivedAt, prevArchived },
        )
        prevArchived = result.prevArchived
        state = { ...state, unarchivedAt: result.unarchivedAt }
        if (result.unarchivedChanged) await persist()
        if (result.archived.length > 0) log.info(`${result.archived.length} 件をアーカイブしました`)
      } catch (error) {
        log.warn(`アーカイブのサイクルに失敗しました: ${String(error)}`)
      } finally {
        running = false
      }
    },
  }
  return runtime
}

export async function apply(ctx: HostContext, rawConfig?: unknown): Promise<void> {
  const config = parseConfig(rawConfig)
  const log = createLogger(ctx.logger, console)
  const home = resolveHome()
  const stateFile = config.stateFile ?? join(home, 'cache-sentinel', 'state.json')
  const sessionsRoot = join(home, 'sessions')

  const runtime = createRuntime(
    config,
    await loadState(stateFile),
    createDeps(ctx, () => scanLogMtimes(sessionsRoot), log),
    log,
    { now: Date.now, save: (state) => saveState(stateFile, state) },
  )

  // 自動圧縮も同じ waterfall の中でモデルを呼ぶので、最も外側で判定する(docs/spike.md W2)。
  ctx.on('agent/pre-step', (payload, next) => runtime.onPreStep(payload, next), { prepend: true })
  ctx.on('session/event', (session, event) => runtime.onSessionEvent(session, event))
  ctx.commands.register({
    name: 'unlock',
    description: 'キャッシュ切れで入力禁止のセッションで、次の送信を許可する(cache-sentinel)',
    handler: ({ agent }) => runtime.unlock(agent),
  })
  ctx.commands.register({
    name: 'sentinel',
    description: 'cache-sentinel の状態表示とモード切り替え: /sentinel [block|archive|both|off|default]',
    handler: ({ agent, rawInput }) => runtime.sentinel(agent, rawInput),
  })
  ctx.interval(() => void runtime.tick(), config.checkIntervalSeconds * 1000)

  log.info(
    `開始 (モード ${runtime.mode()}, 入力禁止 ${config.idleMinutes} 分, both のアーカイブ ${config.archiveAfterMinutes} 分${config.dryRun ? ', dryRun' : ''})`,
  )
  void runtime.tick()
}
