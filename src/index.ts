/**
 * cache-sentinel — Host half(閲覧のみ方式, spec v0.3)。
 * 最後のモデル応答から idleMinutes を超えたセッションでは、モデル / API への送信(ステップ)を拒否する。
 * `/unlock` で次の送信を 1 回だけ許可する。
 *
 * 判定は gate.ts / unlock.ts / last-response.ts の純粋な部品に任せ、ここでは DSH との接続だけを行う。
 * DSH 本体は依存ではないため、使うサービスの形は最小限をここに書き写す(根拠は docs/spike.md W1〜W5)。
 */
import { parseConfig, type Config } from './config.ts'
import { decideGate } from './gate.ts'
import { LastResponseTracker, type TimedEvent } from './last-response.ts'
import { createLogger, type Logger } from './log.ts'
import { decideUnlock, UnlockStore, unlockMessage } from './unlock.ts'

export const name = 'cache-sentinel'
export const inject = ['commands']

/** Session のうち使う部分(dsh-session の Session)。 */
export interface SessionLike {
  readonly id: string
  snapshotEvents(): readonly TimedEvent[]
}

/** Agent のうち使う部分(dsh-agent の Agent)。 */
export interface AgentLike {
  readonly session: SessionLike
}

/** `agent/pre-step` の payload のうち使う部分。 */
export interface PreStepPayload {
  agent: AgentLike
  turn: number
  step: number
}

/** `agent/pre-step` の戻り値(dsh-agent の PreStepDecision)。中身は触らずに素通しする。 */
export type PreStepDecision = { kind: 'reject' } | { kind: 'enter'; [key: string]: unknown }

/** コマンドの戻り値(dsh-commands の CommandResult)。 */
export type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

/** ctx のうち使う部分。 */
export interface HostContext {
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
      handler: (invocation: { agent: AgentLike }) => CommandResult | Promise<CommandResult>
    }): () => void
  }
  logger: Logger
}

/** ゲートの部品をまとめたもの。テストでは ctx なしで直接呼ぶ。 */
export interface Sentinel {
  onPreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
  onSessionEvent(session: SessionLike, event: TimedEvent): void
  unlock(agent: AgentLike): CommandResult
}

/**
 * 設定・ロガー・時計からゲートの部品を作る。
 * 最終応答時刻は、そのとき手元にある Session オブジェクトのイベント列から初回だけ読み、以後は session/event で更新する。
 */
export function createSentinel(config: Config, log: Logger, now: () => number = Date.now): Sentinel {
  // tracker の load は、いま判定しているセッションのオブジェクトから読む(sessions サービスに依存しない)。
  let loading: SessionLike | undefined
  const tracker = new LastResponseTracker((id) => (loading?.id === id ? loading.snapshotEvents() : undefined))
  const unlocks = new UnlockStore()
  const ttlMs = config.unlockTtlMinutes * 60_000

  const lastResponseOf = (session: SessionLike): number | undefined => {
    loading = session
    try {
      return tracker.get(session.id)
    } finally {
      loading = undefined
    }
  }

  return {
    async onPreStep(payload, next) {
      const session = payload.agent.session
      let decision: ReturnType<typeof decideGate>
      try {
        const at = now()
        unlocks.prune(at, ttlMs)
        decision = decideGate({
          now: at,
          lastResponseAt: lastResponseOf(session),
          idleMinutes: config.idleMinutes,
          grantedAt: unlocks.grantedAt(session.id),
          unlockTtlMinutes: config.unlockTtlMinutes,
        })
      } catch (error) {
        // 判定できないときは作業を止めない(spec §7)。
        log.warn(`判定に失敗したため通します: ${session.id}: ${String(error)}`)
        return next()
      }

      if (decision.kind === 'pass') {
        if (decision.reason === 'unlocked') log.info(`/unlock の許可で通しました: ${session.id}`)
        return next()
      }

      const minutes = Math.floor(decision.idleMs / 60_000)
      const where = `${session.id} (最終応答から ${minutes} 分, turn ${payload.turn} step ${payload.step})`
      if (config.dryRun) {
        log.info(`dryRun: ブロック対象 ${where}`)
        return next()
      }
      log.info(`ブロックしました: ${where}。/unlock で次の送信を許可できます`)
      return { kind: 'reject' }
    },

    onSessionEvent(session, event) {
      tracker.observe(session.id, event)
    },

    unlock(agent) {
      const session = agent.session
      const at = now()
      const outcome = decideUnlock({
        now: at,
        lastResponseAt: lastResponseOf(session),
        idleMinutes: config.idleMinutes,
        unlockTtlMinutes: config.unlockTtlMinutes,
      })
      if (outcome.kind === 'granted') {
        unlocks.grant(session.id, at)
        log.info(`/unlock を許可しました: ${session.id} (最終応答から ${outcome.idleMinutes} 分)`)
      }
      return { kind: 'success', text: unlockMessage(outcome) }
    },
  }
}

export function apply(ctx: HostContext, rawConfig?: unknown): void {
  const config = parseConfig(rawConfig)
  const log = createLogger(ctx.logger, console)
  const sentinel = createSentinel(config, log)

  // 自動圧縮も同じ waterfall の中でモデルを呼ぶので、最も外側で判定する(docs/spike.md W2)。
  ctx.on('agent/pre-step', (payload, next) => sentinel.onPreStep(payload, next), { prepend: true })
  ctx.on('session/event', (session, event) => sentinel.onSessionEvent(session, event))
  ctx.commands.register({
    name: 'unlock',
    description: 'キャッシュ切れのセッションで次の送信を許可する(cache-sentinel)',
    handler: ({ agent }) => sentinel.unlock(agent),
  })

  log.info(
    `開始 (閲覧のみ方式: 最終応答から ${config.idleMinutes} 分で送信を停止, /unlock 有効 ${config.unlockTtlMinutes} 分${config.dryRun ? ', dryRun' : ''})`,
  )
}
