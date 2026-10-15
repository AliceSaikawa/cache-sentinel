/**
 * 入力欄の上に出す「入力禁止中」バナー(spec-ui §E2)。純粋関数のみ。
 *
 * ブラウザ(公式 UI / m3e)でも動かすため、`node:` の import と DOM API は使わない。
 * DSH には依存しない。
 */

/** status API(`/api/cache-sentinel.status`)の応答のうち、表示に必要な項目。 */
export interface StatusLike {
  gate: boolean
  state: string
  idleMinutes: number | null
  unlockExpiresAt: number | null
  dryRun: boolean
}

/** 表示するバナー。unlock ボタン付きの警告か、ボタンなしの情報。 */
export type Banner =
  | { tone: 'warning'; text: string; action: 'unlock' }
  | { tone: 'info'; text: string }

/** 許可ボタンのラベル。 */
export const UNLOCK_LABEL = '次の 1 回を許可(/unlock)'

/** 有限数かどうか(NaN / Infinity を弾く)。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 有限数か null かどうか。 */
function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

/**
 * 未知の値を `StatusLike` に検証する。5 項目がすべて正しい型のときだけ、
 * その 5 項目だけを持つ新しいオブジェクトを返す。それ以外は undefined。
 */
export function parseStatus(value: unknown): StatusLike | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const record = value as Record<string, unknown>

  if (
    typeof record['gate'] !== 'boolean' ||
    typeof record['state'] !== 'string' ||
    !isFiniteNumberOrNull(record['idleMinutes']) ||
    !isFiniteNumberOrNull(record['unlockExpiresAt']) ||
    typeof record['dryRun'] !== 'boolean'
  ) {
    return undefined
  }

  return {
    gate: record['gate'],
    state: record['state'],
    idleMinutes: record['idleMinutes'],
    unlockExpiresAt: record['unlockExpiresAt'],
    dryRun: record['dryRun'],
  }
}

/**
 * status からバナーを決める(spec-ui §E2)。純粋関数。
 * - status が無い / gate が偽 → 何も出さない。
 * - state = stale かつ dryRun でない → 警告 + /unlock ボタン。
 * - state = unlocked → 残り時間の情報。
 * - それ以外 → 何も出さない。
 */
export function bannerFor(status: StatusLike | undefined, now: number): Banner | undefined {
  if (status === undefined || !status.gate) {
    return undefined
  }

  if (status.state === 'stale' && !status.dryRun) {
    if (status.idleMinutes === null) {
      return {
        tone: 'warning',
        text: 'キャッシュ切れ。このまま送ると止められます。',
        action: 'unlock',
      }
    }
    return {
      tone: 'warning',
      text: `キャッシュ切れ(最終応答から ${status.idleMinutes} 分)。このまま送ると止められます。`,
      action: 'unlock',
    }
  }

  if (status.state === 'unlocked') {
    if (status.unlockExpiresAt === null) {
      return {
        tone: 'info',
        text: '次の送信を許可中(キャッシュなしの料金になります)。',
      }
    }
    const remainingMinutes = Math.max(0, Math.ceil((status.unlockExpiresAt - now) / 60000))
    return {
      tone: 'info',
      text: `次の送信を許可中(キャッシュなしの料金になります)。あと ${remainingMinutes} 分`,
    }
  }

  return undefined
}

/**
 * status API の URL を組み立てる(spec-ui §E1)。`base` は末尾スラッシュ付きの
 * URL 文字列。sessionId はクエリとしてエンコードする。
 */
export function statusUrl(base: string, sessionId: string): string {
  const url = new URL('api/cache-sentinel.status', base)
  url.searchParams.set('sessionId', sessionId)
  return url.href
}
