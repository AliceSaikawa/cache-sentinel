/**
 * cache-sentinel — Host half(spec v0.4: モード切り替え)。
 * - block: 最終応答から idleMinutes を超えたセッションの送信を拒否(src/block.ts)。`/unlock` で 1 回許可。
 * - archive: idleMinutes を超えたセッションを自動アーカイブ(src/archive.ts, src/cycle.ts)。
 * - both: idleMinutes で入力禁止、archiveAfterMinutes でアーカイブ。
 * - off: 何もしない。
 * 実効モードは `/sentinel` で変えられ、state.json に保存される(なければ YAML の mode)。
 * DSH 本体は依存ではないため、使うサービスの形は最小限をここに書き写す(根拠は docs/spike.md)。
 */
import path, { join } from 'node:path'
import { scanLogMtimes } from './activity.ts'
import { createDeps, resolveHome, type ArchiveServices } from './archive.ts'
import {
  createSentinel,
  type AgentLike,
  type AgentStatus,
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
import { loadState, saveState, stateExists, type State } from './state.ts'
import type { StatusPayload } from './status.ts'

export const name = 'cache-sentinel'
export const inject = ['commands', 'workspaceRegistry', 'sessionPersistence', 'sessions', 'timer', 'connection']

/** 送信前表示のための状態の取得口(spec-ui.md §E1)。 */
export const STATUS_PATH = '/api/cache-sentinel.status'

/** ctx のうち使う部分。 */
export interface HostContext extends ArchiveServices {
  /** サービスを任意に読む口。`profileContext` は profile 起動以外では無いので undefined を返しうる。 */
  get?(name: string): unknown
  on(
    name: 'agent/pre-step',
    listener: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
    options: { prepend: boolean },
  ): () => boolean
  on(name: 'session/event', listener: (session: SessionLike, event: TimedEvent) => void): () => boolean
  /**
   * エージェントの状態遷移(idle ⇄ running)。
   * 型は `@deepseek-ai/dsh-agent` の `runtime-types.d.ts` の `'agent/status'`(payload は `{ agent, status }`)。
   * 通知を turn の外に書くために使う(#27。根拠は spike.md)。
   */
  on(
    name: 'agent/status',
    listener: (payload: { agent: AgentLike; status: AgentStatus }) => void,
  ): () => boolean
  commands: {
    register(definition: {
      name: string
      description: string
      /** 引数を取るコマンドに付ける(docs/spike.md Y1)。無いと入力欄からの引数つきの行がコマンドにならない。 */
      input?: { hint: string }
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

/**
 * ctx からプロファイル名を読む (純粋関数、§C、#9)。取れなければ undefined
 * (profileContext は profile 起動以外では provide されない。spike.md「プロファイル名の取得」Z1)。
 * DSH の `resolveProfileDir` と同じ規則(空・`/` か `\` を含む・`.`・`..`・`node_modules` を拒否、spike.md Z3)に
 * 合わない名前も undefined にする(従来の共有ファイルに落とす)。npm 版 CLI はこの規則を通った名前しか provide しないが、
 * アプリが渡すプロファイルの経路は確認していないので念のために検査する。
 */
export function profileNameOf(ctx: { get?(name: string): unknown }): string | undefined {
  const profile = ctx.get?.('profileContext') as { name?: unknown } | undefined
  const name = profile?.name
  if (typeof name !== 'string') return undefined
  const invalid =
    name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name === 'node_modules'
  return invalid ? undefined : name
}

/** 永続状態の場所。`legacy` は移行元(プロファイル別の既定の場所を使うときだけある)。 */
export interface StateLocation {
  file: string
  legacy?: string
}

/**
 * 永続状態の場所を決める (純粋関数、§C)。
 * - 設定 `stateFile` があればそれだけを使う(移行しない)。
 * - プロファイル名があれば `<home>/cache-sentinel/profiles/<名前>/state.json`。移行元は従来の共有ファイル。
 * - プロファイル名が無ければ従来の共有 `<home>/cache-sentinel/state.json`(後方互換)。
 * プロファイル名は変換しない(DSH が `profiles/<名前>` に使う名前と同じ。spike.md Z3)。
 * `p` に `node:path` の `win32` / `posix` を渡すと、その OS の区切り文字で組み立てる(既定は実行環境の OS)。
 */
export function statePathFor(
  home: string,
  profileName: string | undefined,
  configured: string | undefined,
  p: typeof path = path,
): StateLocation {
  if (configured !== undefined) return { file: configured }
  const legacy = p.join(home, 'cache-sentinel', 'state.json')
  if (profileName === undefined) return { file: legacy }
  return { file: p.join(home, 'cache-sentinel', 'profiles', profileName, 'state.json'), legacy }
}

/**
 * 起動時の状態を読む (§C、#9)。
 * - `legacy` が無い(設定 `stateFile` か、プロファイル名なし)、またはプロファイル別のファイルがある → `file` を読む。
 * - プロファイル別のファイルが無い → 従来の共有ファイルを読み(無ければ空の状態)、その内容で
 *   プロファイル別のファイルを作る。以後の起動では従来のファイルを読まない。従来のファイルは消さない・書き換えない。
 *   作れなかったときは warn を出し、読んだ内容で動く(次の起動でもう一度移行する)。
 */
export async function loadInitialState(location: StateLocation, log: Logger): Promise<State> {
  const { file, legacy } = location
  if (legacy === undefined || (await stateExists(file))) return loadState(file)
  const state = await loadState(legacy)
  try {
    await saveState(file, state)
    log.info(`状態ファイルを作りました: ${file}(従来の ${legacy} から引き継ぎ。無ければ空の状態)`)
  } catch (error) {
    log.warn(`state.json の保存に失敗しました: ${String(error)}`)
  }
  return state
}

/** モード・入力禁止・アーカイブをまとめた実行時の部品。ctx なしでテストできる。 */
export interface Runtime {
  mode(): Mode
  onPreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
  onSessionEvent(session: SessionLike, event: TimedEvent): void
  onAgentStatus(status: AgentStatus, session: SessionLike): void
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
    onAgentStatus: (status, session) => block.onAgentStatus(status, session),
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
  const profile = profileNameOf(ctx)
  const location = statePathFor(home, profile, config.stateFile)
  const initialState = await loadInitialState(location, log)
  const sessionsRoot = join(home, 'sessions')

  const runtime = createRuntime(
    config,
    initialState,
    createDeps(ctx, () => scanLogMtimes(sessionsRoot), log),
    log,
    { now: Date.now, save: (state) => saveState(location.file, state) },
    locale,
  )

  // 自動圧縮も同じ waterfall の中でモデルを呼ぶので、最も外側で判定する(docs/spike.md W2)。
  ctx.on('agent/pre-step', (payload, next) => runtime.onPreStep(payload, next), { prepend: true })
  ctx.on('session/event', (session, event) => runtime.onSessionEvent(session, event))
  // 通知を turn の外に書く(#27)。idle への遷移は blocked の turn/end の後に必ず来る(spike.md)。
  ctx.on('agent/status', ({ agent, status }) => runtime.onAgentStatus(status, agent.session))
  ctx.commands.register({
    name: 'unlock',
    description: MESSAGES[locale].commandUnlockDescription,
    handler: ({ agent }) => runtime.unlock(agent),
  })
  ctx.commands.register({
    name: 'sentinel',
    description: MESSAGES[locale].commandSentinelDescription,
    // 入力欄から `/sentinel archive` のように引数つきで実行できるようにする(#36、根拠は docs/spike.md Y1/Y2)。
    // 引数は任意で、解釈は runtime.sentinel の parseSentinelArgs が行う。
    input: { hint: MESSAGES[locale].commandSentinelInputHint },
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
  // どのプロファイルの状態を使っているかを実機で確認できるようにする(プロファイル名が取れないときは共有ファイル)。
  log.info(`状態ファイル: ${location.file}${profile === undefined ? ' (プロファイル名なし)' : ''}`)
  void runtime.tick()
}
