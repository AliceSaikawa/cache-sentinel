/**
 * 送信前バナーのための状態計算(spec-ui v0.5 §E1)。純粋関数のみ。DSH には依存しない。
 *
 * 判定順:
 * 1. gate が偽 → inactive(このセッションでは入力禁止が働かない)。
 * 2. gate が真でセッション未読込(known が偽)→ unknown。
 * 3. 最終応答がない → no-response。
 * 4. 経過 <= idleMinutes → fresh(境界ちょうどは fresh)。
 * 5. 有効な解除許可がある → unlocked。
 * 6. それ以外 → stale。
 */

import { isGrantValid } from './gate.ts'

/** バナーが表示する状態(spec-ui §E1)。 */
export type StatusState =
  | 'inactive'
  | 'unknown'
  | 'no-response'
  | 'fresh'
  | 'stale'
  | 'unlocked'

/** `/api/cache-sentinel.status` が返す JSON の形(spec-ui §E1)。 */
export interface StatusPayload {
  mode: string
  gate: boolean
  state: StatusState
  idleMinutes: number | null
  thresholdMinutes: number
  unlockExpiresAt: number | null
  dryRun: boolean
}

/**
 * 経過ミリ秒。時計巻き戻り(lastResponseAt > now)は 0 として扱い、
 * 負の経過で判定がおかしくならないようにする(gate.ts と同じ方針)。
 */
function elapsedMs(now: number, lastResponseAt: number): number {
  return Math.max(0, now - lastResponseAt)
}

/** 経過分。切り捨て。 */
function elapsedMinutes(now: number, lastResponseAt: number): number {
  return Math.floor(elapsedMs(now, lastResponseAt) / 60000)
}

/**
 * バナーの状態を計算する(spec-ui §E1)。入力は変更しない。
 * mode と dryRun はそのまま写し、thresholdMinutes は idleMinutes を使う。
 */
export function computeStatus(input: {
  mode: string
  gate: boolean
  known: boolean
  now: number
  lastResponseAt: number | undefined
  idleMinutes: number
  grantedAt: number | undefined
  unlockTtlMinutes: number
  dryRun: boolean
}): StatusPayload {
  const {
    mode,
    gate,
    known,
    now,
    lastResponseAt,
    idleMinutes,
    grantedAt,
    unlockTtlMinutes,
    dryRun,
  } = input
  const thresholdMinutes = idleMinutes

  // 1. 入力禁止が働かないモード。ゲートが真かどうかより優先する。
  if (!gate) {
    const idle =
      known && lastResponseAt !== undefined
        ? elapsedMinutes(now, lastResponseAt)
        : null
    return {
      mode,
      gate,
      state: 'inactive',
      idleMinutes: idle,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun,
    }
  }

  // 2. セッションがまだ読み込まれていない。
  if (!known) {
    return {
      mode,
      gate,
      state: 'unknown',
      idleMinutes: null,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun,
    }
  }

  // 3. このセッションにまだモデル応答がない。
  if (lastResponseAt === undefined) {
    return {
      mode,
      gate,
      state: 'no-response',
      idleMinutes: null,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun,
    }
  }

  const idle = elapsedMinutes(now, lastResponseAt)

  // 4. 失効していない(境界ちょうどは fresh)。
  if (elapsedMs(now, lastResponseAt) <= idleMinutes * 60000) {
    return {
      mode,
      gate,
      state: 'fresh',
      idleMinutes: idle,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun,
    }
  }

  // 5. 失効中でも有効な解除許可があれば unlocked。
  if (grantedAt !== undefined && isGrantValid({ now, lastResponseAt, grantedAt, unlockTtlMinutes })) {
    return {
      mode,
      gate,
      state: 'unlocked',
      idleMinutes: idle,
      thresholdMinutes,
      unlockExpiresAt: grantedAt + unlockTtlMinutes * 60000,
      dryRun,
    }
  }

  // 6. それ以外は失効中。
  return {
    mode,
    gate,
    state: 'stale',
    idleMinutes: idle,
    thresholdMinutes,
    unlockExpiresAt: null,
    dryRun,
  }
}
