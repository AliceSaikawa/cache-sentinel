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
import { resolveLocale, type Locale } from './i18n.ts'
import type { TimedEvent } from './last-response.ts'
import { createLogger, type Logger } from './log.ts'
import { MESSAGES } from './messages.ts'
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
import type { StatusPayload } from './status.ts'

export const name = 'cache-sentinel'
export const inject = ['commands', 'workspaceRegistry', 'sessionPersistence', 'sessions', 'timer', 'connection']

/** 送信前表示のための状態の取得口(spec-ui.md §E1)。 */
export const STATUS_PATH = '/api/cache-sentinel.status'

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
  sessions: {
    get(id: string): (SessionLike & { ownEvents(): readonly { time: number }[] }) | undefined
  }
  connection: {
    fetch: {
      register(route: {
        path: string
        methods: string[]
        requestBody: 'buffered'
        fetch: (request: Request) => Promise<Response>
      }): unknown
    }
  }
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
  /** 状態の取得口の中身。session が undefined なら読み込まれていないセッション。 */
  status(session: SessionLike | undefined): StatusPayload
}

export function createRuntime(
  config: Config,
  initialState: State,
  cycleDeps: CycleDeps,
  log: Logger,
  io: RuntimeIO,
  locale: Locale,
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

  const block = createSentinel(config, log, locale, io.now, () => blocks(current().mode))

  const runtime: Runtime = {
    mode: () => current().mode,
    onPreStep: (payload, next) => block.onPreStep(payload, next),
    onSessionEvent: (session, event) => block.onSessionEvent(session, event),
    unlock: (agent) => block.unlock(agent, unlockInactiveMessage(current().mode, locale)),
    status: (session) => block.statusOf(session, current().mode),

    async sentinel(agent, rawInput) {
      const command = parseSentinelArgs(rawInput)
      if (command.kind === 'invalid') return { kind: 'error', text: usageMessage(locale) }
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
        }, locale),
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

/** 状態の取得口の応答を作る。sessionId が無ければ 400。 */
export function statusResponse(request: Request, lookup: (sessionId: string) => StatusPayload): Response {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  if (sessionId === null || sessionId === '') {
    return new Response('missing sessionId query parameter', { status: 400 })
  }
  return new Response(JSON.stringify(lookup(sessionId)), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function apply(ctx: HostContext, rawConfig?: unknown): Promise<void> {
  const locale = resolveLocale([
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ])
  const config = parseConfig(rawConfig, locale)
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
    locale,
  )

  // 自動圧縮も同じ waterfall の中でモデルを呼ぶので、最も外側で判定する(docs/spike.md W2)。
  ctx.on('agent/pre-step', (payload, next) => runtime.onPreStep(payload, next), { prepend: true })
  ctx.on('session/event', (session, event) => runtime.onSessionEvent(session, event))
  ctx.commands.register({
    name: 'unlock',
    description: MESSAGES[locale].commandUnlockDescription,
    handler: ({ agent }) => runtime.unlock(agent),
  })
  ctx.commands.register({
    name: 'sentinel',
    description: MESSAGES[locale].commandSentinelDescription,
    handler: ({ agent, rawInput }) => runtime.sentinel(agent, rawInput),
  })
  ctx.interval(() => void runtime.tick(), config.checkIntervalSeconds * 1000)
  ctx.connection.fetch.register({
    path: STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => statusResponse(request, (id) => runtime.status(ctx.sessions.get(id))),
  })

  log.info(
    `開始 (モード ${runtime.mode()}, 入力禁止 ${config.idleMinutes} 分, both のアーカイブ ${config.archiveAfterMinutes} 分${config.dryRun ? ', dryRun' : ''})`,
  )
  void runtime.tick()
}
