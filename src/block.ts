/**
 * 入力禁止(block)— spec v0.4「入力禁止の詳細」§1〜§9。
 * 最後のモデル応答から idleMinutes を超えたセッションでは、モデル / API への送信(ステップ)を拒否する。
 * `/unlock` で次の送信を 1 回だけ許可する。ゲートが働くかは `isActive()`(実効モード)で毎回決める。
 */
import type { Config } from './config.ts'
import { decideGate } from './gate.ts'
import type { Locale } from './i18n.ts'
import { LastResponseTracker, type TimedEvent } from './last-response.ts'
import type { Logger } from './log.ts'
import { buildBlockNotice, NoticeThrottle, type NoticeMessage } from './notice.ts'
import { computeStatus, type StatusPayload } from './status.ts'
import { decideUnlock, UnlockStore, unlockMessage } from './unlock.ts'

/** 入力 0 件の拒否を通知する最短間隔(spec-ui.md §D)。 */
export const NOTICE_INTERVAL_MS = 10 * 60_000

/** Session のうち使う部分(dsh-session の Session)。 */
export interface SessionLike {
  readonly id: string
  snapshotEvents(): readonly TimedEvent[]
  /** dsh-session の Session.append。ブロック通知(command/run と command/done)の追加に使う。 */
  append?(type: string, data: unknown): unknown
}

/** Agent のうち使う部分(dsh-agent の Agent)。 */
export interface AgentLike {
  readonly session: SessionLike
}

/** `agent/pre-step` の payload のうち使う部分。 */
export interface PreStepPayload {
  agent: AgentLike
  /** このステップに入る予定の入力。拒否すると破棄される。 */
  messages?: readonly NoticeMessage[]
  turn: number
  step: number
}

/** `agent/pre-step` の戻り値(dsh-agent の PreStepDecision)。中身は触らずに素通しする。 */
export type PreStepDecision = { kind: 'reject' } | { kind: 'enter'; [key: string]: unknown }

/** コマンドの戻り値(dsh-commands の CommandResult)。 */
export type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

/** 入力禁止の部品。 */
export interface Sentinel {
  onPreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
  onSessionEvent(session: SessionLike, event: TimedEvent): void
  /** `/unlock`。ゲートが無効なら inactiveText を返す。 */
  unlock(agent: AgentLike, inactiveText: string): CommandResult
  /** 最終応答からの経過分(切り捨て)。応答がなければ undefined。 */
  idleMinutesOf(session: SessionLike): number | undefined
  /** 状態の取得口の中身(spec-ui.md §E1)。session が undefined なら読み込まれていないセッション。 */
  statusOf(session: SessionLike | undefined, mode: string): StatusPayload
}

export type BlockSettings = Pick<Config, 'idleMinutes' | 'unlockTtlMinutes' | 'dryRun'>

/**
 * 設定・ロガー・表示言語・時計・有効判定から入力禁止の部品を作る。
 * 最終応答時刻は、そのとき手元にある Session のイベント列から初回だけ読み、以後は session/event で更新する。
 * 会話に書き込むブロック通知は `locale` (プロセスで 1 回決める。spec-ui v0.5 §F) で作る。
 */
export function createSentinel(
  config: BlockSettings,
  log: Logger,
  locale: Locale,
  now: () => number = Date.now,
  isActive: () => boolean = () => true,
): Sentinel {
  // tracker の load は、いま判定しているセッションのオブジェクトから読む(sessions サービスに依存しない)。
  let loading: SessionLike | undefined
  const tracker = new LastResponseTracker((id) => (loading?.id === id ? loading.snapshotEvents() : undefined))
  const unlocks = new UnlockStore()
  const ttlMs = config.unlockTtlMinutes * 60_000
  const throttle = new NoticeThrottle(NOTICE_INTERVAL_MS)
  let noticeCounter = 0

  /** 会話にブロック通知を出す(両 UI がコマンド結果として描画する)。失敗しても拒否は続ける。 */
  const notify = (session: SessionLike, idleMinutes: number, messages: readonly NoticeMessage[]): void => {
    const at = now()
    if (session.append === undefined || !throttle.shouldNotify(session.id, at, messages.length > 0)) return
    const commandId = `cache-sentinel-${session.id}-${at}-${++noticeCounter}`
    try {
      session.append('command/run', { commandId, name: 'cache-sentinel', args: '', source: { kind: 'user' } })
      session.append('command/done', { commandId, kind: 'error', text: buildBlockNotice({ idleMinutes, messages }, locale) })
    } catch (error) {
      log.warn(`ブロック通知を会話に追加できませんでした: ${session.id}: ${String(error)}`)
    }
  }

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
      if (!isActive()) return next()
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
      notify(session, minutes, payload.messages ?? [])
      return { kind: 'reject' }
    },

    onSessionEvent(session, event) {
      tracker.observe(session.id, event)
    },

    unlock(agent, inactiveText) {
      if (!isActive()) return { kind: 'success', text: inactiveText }
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
      return { kind: 'success', text: unlockMessage(outcome, locale) }
    },

    idleMinutesOf(session) {
      const last = lastResponseOf(session)
      return last === undefined ? undefined : Math.floor(Math.max(0, now() - last) / 60_000)
    },

    statusOf(session, mode) {
      const at = now()
      unlocks.prune(at, ttlMs)
      return computeStatus({
        mode,
        gate: isActive(),
        known: session !== undefined,
        now: at,
        lastResponseAt: session === undefined ? undefined : lastResponseOf(session),
        idleMinutes: config.idleMinutes,
        grantedAt: session === undefined ? undefined : unlocks.grantedAt(session.id),
        unlockTtlMinutes: config.unlockTtlMinutes,
        dryRun: config.dryRun,
      })
    },
  }
}
