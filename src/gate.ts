/**
 * ゲート判定(spec §3, §4)。純粋関数のみ。DSH には依存しない。
 *
 * - 最終応答時刻が無い(新規セッション) → 通す。
 * - 失効していない(経過 <= idleMinutes) → 通す。境界ちょうどは通す。
 * - ユーザーの送信で始まるターンの最初のステップでない → 通す。
 * - 有効な解除許可がある → 通す(許可は消費しない)。
 * - それ以外 → ブロックする。ブロック理由として経過ミリ秒を返す。
 */

/**
 * ステップの種類(spec §3)。止める対象は `user-send` だけ。
 * - `user-send`: ターンの最初のステップで、ユーザーの送信(`source.kind === 'user'`)を含む。
 * - `mid-turn`: ターンの 2 ステップ目以降(ツール実行の後の続きなど)。
 * - `other-input`: ターンの最初のステップだが、ユーザーの送信を含まない(ジョブ完了・サブエージェント・ゴール・リマインダーなど)。
 */
export type StepKind = 'user-send' | 'mid-turn' | 'other-input'

/**
 * `agent/pre-step` のステップ番号と入力の出どころからステップの種類を決める。
 * DSH はターンごとにステップを 1 から数える。
 * @param step - ターン内のステップ番号。
 * @param sourceKinds - そのステップに入る入力の `source.kind`。
 */
export function classifyStep(step: number, sourceKinds: readonly string[]): StepKind {
  if (step > 1) return 'mid-turn'
  return sourceKinds.includes('user') ? 'user-send' : 'other-input'
}

/** ゲートの判定結果。block は拒否すべきことを表す(呼び出し側が next() を呼ばない)。 */
export type GateDecision =
  | { kind: 'pass'; reason: 'no-response' | 'fresh' | Exclude<StepKind, 'user-send'> | 'unlocked' }
  | { kind: 'block'; idleMs: number }

/** decideGate の入力。時刻はすべてエポックミリ秒。 */
export interface GateInput {
  now: number
  lastResponseAt: number | undefined
  idleMinutes: number
  grantedAt: number | undefined
  unlockTtlMinutes: number
  stepKind: StepKind
}

/**
 * 経過時間を求める。時計巻き戻り(lastResponseAt > now)は 0 として扱い、
 * 負の経過で判定がおかしくならないようにする。
 */
function elapsedMs(now: number, lastResponseAt: number): number {
  return Math.max(0, now - lastResponseAt)
}

/**
 * 解除許可が有効かどうか(spec §4)。
 * - 許可が無い(grantedAt === undefined) → 偽。
 * - 許可から unlockTtlMinutes を過ぎた → 偽。境界ちょうどは有効。
 * - 許可後にモデル応答があった(lastResponseAt >= grantedAt) → 偽。
 *   許可は「最後の応答の後、まだ送っていない 1 回」のためだけに使える。
 * - 時計巻き戻り(now < grantedAt)は上記のどれにも当たらない限り有効として扱う。
 */
export function isGrantValid(input: {
  now: number
  lastResponseAt: number | undefined
  grantedAt: number | undefined
  unlockTtlMinutes: number
}): boolean {
  const { now, lastResponseAt, grantedAt, unlockTtlMinutes } = input
  if (grantedAt === undefined) {
    return false
  }
  if (now - grantedAt > unlockTtlMinutes * 60000) {
    return false
  }
  if (lastResponseAt !== undefined && lastResponseAt >= grantedAt) {
    return false
  }
  return true
}

/**
 * ゲートを判定する(spec §3)。判定は次の順で行う。
 * 1. lastResponseAt が undefined → pass/no-response(新規セッション)。
 * 2. 経過 <= idleMinutes 分 → pass/fresh。
 * 3. stepKind が user-send でない → pass/mid-turn または pass/other-input。
 * 4. 有効な解除許可がある → pass/unlocked。
 * 5. それ以外 → block(idleMs = 経過)。
 */
export function decideGate(input: GateInput): GateDecision {
  const { now, lastResponseAt, idleMinutes, grantedAt, unlockTtlMinutes, stepKind } = input

  if (lastResponseAt === undefined) {
    return { kind: 'pass', reason: 'no-response' }
  }

  const idle = elapsedMs(now, lastResponseAt)
  if (idle <= idleMinutes * 60000) {
    return { kind: 'pass', reason: 'fresh' }
  }

  if (stepKind !== 'user-send') {
    return { kind: 'pass', reason: stepKind }
  }

  if (isGrantValid({ now, lastResponseAt, grantedAt, unlockTtlMinutes })) {
    return { kind: 'pass', reason: 'unlocked' }
  }

  return { kind: 'block', idleMs: idle }
}
