/**
 * 入力禁止(block)— spec「入力禁止の詳細」§1〜§9。
 * 最後のモデル応答から idleMinutes を超えたセッションでは、ユーザーの送信で始まるターンの最初のステップを拒否する。
 * ターン途中のステップと、ユーザーの送信を含まない入力(ジョブ完了・サブエージェント・ゴール・リマインダーなど)は通す。
 * `/unlock` で次の送信を 1 回だけ許可する。ゲートが働くかは `isActive()`(実効モード)で毎回決める。
 * 会話への通知は、同じ文面が連続するときだけ 10 分に 1 件に抑える(spec-ui §D、#30)。拒否そのものは毎回行う。
 * 間にユーザーの送信が通れば、連続とはみなさない。
 */
import type { Config } from './config.ts'
import { classifyStep, decideGate, type StepKind } from './gate.ts'
import type { Locale } from './i18n.ts'
import { LastResponseTracker, type SessionView, type TimedEvent } from './last-response.ts'
import type { Logger } from './log.ts'
import {
  buildBlockNotice,
  NoticeDedupe,
  NOTICE_DEDUPE_INTERVAL_MS,
  noticeDedupeKey,
  type NoticeMessage,
} from './notice.ts'
import { computeStatus, type StatusPayload } from './status.ts'
import { decideUnlock, UnlockStore, unlockMessage } from './unlock.ts'

/** Session の header のうち使う部分(dsh-session の SessionHeader)。 */
export interface SessionHeaderLike {
  /** サブエージェントの子として作られたセッションか(spec §2 の例外の判定)。 */
  readonly origin?: string
  /** セッションの作成時刻(epoch ms)。 */
  readonly createdAt?: number
  /** fork で引き継いだ prefix を持つか。 */
  readonly isSeeded?: boolean
}

/** Session のうち使う部分(dsh-session の Session)。 */
export interface SessionLike {
  readonly id: string
  /** 引き継いだ部分も含むイベント列。 */
  snapshotEvents(): readonly TimedEvent[]
  /**
   * このセッション自身が書いたイベント列(引き継いだ prefix を除く。dsh-session の `ownEvents()`)。
   * サブエージェントの fork の子だけが使う。無ければ `snapshotEvents()` で代用する。
   */
  ownEvents?(): readonly TimedEvent[]
  /** 作成メタデータ(dsh-session の `session.header`)。無ければ従来どおりに判定する。 */
  readonly header?: SessionHeaderLike
  /** dsh-session の Session.append。ブロック通知(command/run と command/done)の追加に使う。 */
  append?(type: string, data: unknown): unknown
}

/** Agent のうち使う部分(dsh-agent の Agent)。 */
export interface AgentLike {
  readonly session: SessionLike
}

/** `agent/pre-step` の messages の 1 件のうち使う部分(dsh-llm の UserMessage)。 */
export interface StepMessage extends NoticeMessage {
  /**
   * 入力の出どころ。ユーザーの送信は `'user'`(spike.md「止める対象の判定材料」)。
   * DSH の型では必須だが、欠けたメッセージ 1 件でステップ全体が判定の例外(fail-open)にならないよう任意として読む。
   */
  readonly source?: { readonly kind: string }
}

/** `agent/pre-step` の payload のうち使う部分。 */
export interface PreStepPayload {
  agent: AgentLike
  /** このステップに入る予定の入力。拒否すると破棄される。 */
  messages: readonly StepMessage[]
  turn: number
  /** ターン内のステップ番号(1 から)。 */
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
 * DSH の Session を判定用の見え方に落とす(spec §2)。DSH 依存はここに閉じる。
 * サブエージェントの fork の子(`origin === 'subagent'` かつ `isSeeded`)だけ、引き継いだ prefix を除いた
 * `ownEvents()` と作成時刻を渡す。それ以外(fork でないサブエージェントを含む)は従来どおり全イベントから探す。
 */
function sessionViewOf(session: SessionLike): SessionView {
  if (session.header?.origin !== 'subagent' || session.header.isSeeded !== true) return {}
  return {
    ownEvents: session.ownEvents?.() ?? session.snapshotEvents(),
    createdAt: session.header.createdAt,
  }
}

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
  const tracker = new LastResponseTracker((id) => {
    if (loading?.id !== id) return undefined
    const session = loading
    return { events: session.snapshotEvents(), view: sessionViewOf(session) }
  })
  const unlocks = new UnlockStore()
  const dedupe = new NoticeDedupe(NOTICE_DEDUPE_INTERVAL_MS)
  const ttlMs = config.unlockTtlMinutes * 60_000
  let noticeCounter = 0

  /**
   * 会話にブロック通知を出す(両 UI がコマンド結果として描画する)。失敗しても拒否は続ける。
   * 直前に出した通知と破棄された入力が同じなら、NOTICE_DEDUPE_INTERVAL_MS 未満は出さず info ログだけ残す
   * (spec-ui §D、#30)。
   */
  const notify = (session: SessionLike, idleMinutes: number, messages: readonly NoticeMessage[]): void => {
    if (session.append === undefined) return
    const at = now()
    const key = noticeDedupeKey(messages, locale)
    if (!dedupe.shouldSend(session.id, at, key)) {
      log.info(`同じ文面のブロック通知を抑えました: ${session.id} (最終応答から ${idleMinutes} 分)`)
      return
    }
    const commandId = `cache-sentinel-${session.id}-${at}-${++noticeCounter}`
    try {
      session.append('command/run', { commandId, name: 'cache-sentinel', args: '', source: { kind: 'user' } })
      session.append('command/done', {
        commandId,
        kind: 'error',
        text: buildBlockNotice({ idleMinutes, messages }, locale),
      })
      // 会話に出せたときだけ「出した」と記録する。失敗した文面は次の拒否でまた通知する。
      dedupe.record(session.id, at, key)
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
      let sourceKinds: string[]
      let stepKind: StepKind
      try {
        const at = now()
        unlocks.prune(at, ttlMs)
        dedupe.prune(at)
        sourceKinds = payload.messages.map((message) => message.source?.kind ?? '(source なし)')
        stepKind = classifyStep(payload.step, sourceKinds)
        decision = decideGate({
          now: at,
          lastResponseAt: lastResponseOf(session),
          idleMinutes: config.idleMinutes,
          grantedAt: unlocks.grantedAt(session.id),
          unlockTtlMinutes: config.unlockTtlMinutes,
          stepKind,
        })
      } catch (error) {
        // 判定できないときは作業を止めない(spec §7)。
        log.warn(`判定に失敗したため通します: ${session.id}: ${String(error)}`)
        return next()
      }

      const position = `turn ${payload.turn} step ${payload.step}`
      if (decision.kind === 'pass') {
        // ユーザーの送信が通ったら、前の通知との「連続」は切れる(spec-ui §D)。
        if (stepKind === 'user-send' && (decision.reason === 'fresh' || decision.reason === 'unlocked')) {
          dedupe.forget(session.id)
        }
        switch (decision.reason) {
          case 'unlocked':
            log.info(`/unlock の許可で通しました: ${session.id}`)
            break
          case 'mid-turn':
            log.info(`失効していますがターンの途中なので通しました: ${session.id} (${position})`)
            break
          case 'other-input': {
            const sources = sourceKinds.length === 0 ? 'なし' : sourceKinds.join(', ')
            log.info(`失効していますがユーザーの送信ではないので通しました: ${session.id} (${position}, 入力: ${sources})`)
            break
          }
        }
        return next()
      }

      const minutes = Math.floor(decision.idleMs / 60_000)
      const where = `${session.id} (最終応答から ${minutes} 分, ${position})`
      if (config.dryRun) {
        log.info(`dryRun: ブロック対象 ${where}`)
        return next()
      }
      log.info(`ブロックしました: ${where}。/unlock で次の送信を許可できます`)
      notify(session, minutes, payload.messages)
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
