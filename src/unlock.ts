/**
 * 解除許可(`/unlock`)のメモリ管理と判定(spec §4)。DSH には依存しない。
 *
 * - `UnlockStore`: セッション id ごとに許可時刻(grantedAt)を保持する。永続化はしない(再起動で消える)。
 * - `decideUnlock`: `/unlock` 実行時の判定(失効中 / 失効していない / 応答なし)。
 * - `unlockMessage`: 判定結果を GUI に表示する文へ変換する(表示言語は spec-ui v0.5 §F)。
 */

import type { Locale } from './i18n.ts'
import { MESSAGES } from './messages.ts'

/** セッション id ごとの解除許可を保持する。永続化しないメモリ上のストア。 */
export class UnlockStore {
  private readonly grants = new Map<string, number>()

  /** 許可を記録する。既に許可があれば上書きする(spec §4: grantedAt = now)。 */
  grant(sessionId: string, now: number): void {
    this.grants.set(sessionId, now)
  }

  /** 許可時刻を返す。無ければ undefined。 */
  grantedAt(sessionId: string): number | undefined {
    return this.grants.get(sessionId)
  }

  /** 許可を取り消す。無いセッションに対しては何もしない。 */
  revoke(sessionId: string): void {
    this.grants.delete(sessionId)
  }

  /**
   * TTL を過ぎた許可を削除する。`now - grantedAt > ttlMs` のものを消す。
   * 境界ちょうど(`now - grantedAt === ttlMs`)は残す。時計巻き戻り(負の経過)も残す。
   */
  prune(now: number, ttlMs: number): void {
    for (const [sessionId, grantedAt] of this.grants) {
      if (now - grantedAt > ttlMs) {
        this.grants.delete(sessionId)
      }
    }
  }
}

/** `/unlock` の判定結果。 */
export type UnlockOutcome =
  | { kind: 'granted'; idleMinutes: number; ttlMinutes: number }
  | { kind: 'fresh'; idleMinutes: number }
  | { kind: 'no-response' }

/**
 * `/unlock` 実行時の判定(spec §4)。純粋関数。
 * - lastResponseAt が undefined → 応答なし(許可は記録しない)。
 * - 経過 <= idleMinutes 分 → 失効していない(許可は記録しない)。
 * - それ以外 → 許可を付与する。
 * idleMinutes は経過を分に切り捨てた整数、ttlMinutes は unlockTtlMinutes。
 */
export function decideUnlock(input: {
  now: number
  lastResponseAt: number | undefined
  idleMinutes: number
  unlockTtlMinutes: number
}): UnlockOutcome {
  const { now, lastResponseAt, idleMinutes, unlockTtlMinutes } = input

  if (lastResponseAt === undefined) {
    return { kind: 'no-response' }
  }

  // 時計巻き戻り(lastResponseAt > now)は経過 0 として扱う。
  const elapsed = Math.max(0, now - lastResponseAt)
  const elapsedMinutes = Math.floor(elapsed / 60000)

  if (elapsed <= idleMinutes * 60000) {
    return { kind: 'fresh', idleMinutes: elapsedMinutes }
  }

  return { kind: 'granted', idleMinutes: elapsedMinutes, ttlMinutes: unlockTtlMinutes }
}

/** 判定結果を GUI に表示する文へ変換する(spec §4)。`locale` は表示言語 (spec-ui v0.5 §F)。 */
export function unlockMessage(outcome: UnlockOutcome, locale: Locale): string {
  const m = MESSAGES[locale]
  switch (outcome.kind) {
    case 'granted':
      return m.unlockGranted(outcome.idleMinutes, outcome.ttlMinutes)
    case 'fresh':
      return m.unlockFresh(outcome.idleMinutes)
    case 'no-response':
      return m.unlockNoResponse
  }
}
