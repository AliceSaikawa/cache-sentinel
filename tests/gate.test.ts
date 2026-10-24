import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyStep, decideGate, isGrantValid } from '../src/gate.ts'

const MINUTE = 60000
const NOW = 1_700_000_000_000

/** 失効中(経過 > idleMinutes)のユーザーの送信の入力を作る補助。 */
function expiredInput(overrides: Partial<Parameters<typeof decideGate>[0]> = {}): Parameters<typeof decideGate>[0] {
  return {
    now: NOW,
    lastResponseAt: NOW - 90 * MINUTE,
    idleMinutes: 60,
    grantedAt: undefined,
    unlockTtlMinutes: 10,
    stepKind: 'user-send',
    ...overrides,
  }
}

test('応答がまだ無い(新規セッション)は pass/no-response', () => {
  assert.deepEqual(
    decideGate({
      now: NOW,
      lastResponseAt: undefined,
      idleMinutes: 60,
      grantedAt: undefined,
      unlockTtlMinutes: 10,
      stepKind: 'user-send',
    }),
    { kind: 'pass', reason: 'no-response' },
  )
})

test('新規セッションは許可の有無に関わらず pass/no-response', () => {
  assert.deepEqual(
    decideGate({
      now: NOW,
      lastResponseAt: undefined,
      idleMinutes: 60,
      grantedAt: NOW - MINUTE,
      unlockTtlMinutes: 10,
      stepKind: 'user-send',
    }),
    { kind: 'pass', reason: 'no-response' },
  )
})

test('失効していなければ pass/fresh', () => {
  assert.deepEqual(
    decideGate(expiredInput({ lastResponseAt: NOW - 59 * MINUTE })),
    { kind: 'pass', reason: 'fresh' },
  )
  assert.deepEqual(
    decideGate(expiredInput({ lastResponseAt: NOW })),
    { kind: 'pass', reason: 'fresh' },
  )
})

test('境界: ちょうど idleMinutes は通し、1ms 超えると block', () => {
  assert.deepEqual(
    decideGate(expiredInput({ lastResponseAt: NOW - 60 * MINUTE })),
    { kind: 'pass', reason: 'fresh' },
  )
  assert.deepEqual(
    decideGate(expiredInput({ lastResponseAt: NOW - 60 * MINUTE - 1 })),
    { kind: 'block', idleMs: 60 * MINUTE + 1 },
  )
})

test('時計巻き戻り(lastResponseAt > now)は経過 0 として pass/fresh', () => {
  assert.deepEqual(
    decideGate(expiredInput({ lastResponseAt: NOW + 5 * MINUTE })),
    { kind: 'pass', reason: 'fresh' },
  )
})

test('許可があれば失効中でも pass/unlocked', () => {
  assert.deepEqual(
    decideGate(expiredInput({ grantedAt: NOW - MINUTE })),
    { kind: 'pass', reason: 'unlocked' },
  )
})

test('許可の TTL 境界: ちょうどは有効、1ms 超えると無効', () => {
  assert.deepEqual(
    decideGate(expiredInput({ grantedAt: NOW - 10 * MINUTE })),
    { kind: 'pass', reason: 'unlocked' },
  )
  assert.equal(
    decideGate(expiredInput({ grantedAt: NOW - 10 * MINUTE - 1 })).kind,
    'block',
  )
})

test('B5: 許可後に応答があったら無効(失効中は block、失効前は fresh)', () => {
  // 許可(NOW-90分)より後に応答(NOW-80分)があり、その後また失効した。
  const revoked = expiredInput({ grantedAt: NOW - 90 * MINUTE, lastResponseAt: NOW - 80 * MINUTE })
  assert.deepEqual(decideGate(revoked), { kind: 'block', idleMs: 80 * MINUTE })

  // 許可の直後に応答があり、まだ失効していないなら通常どおり通る。
  assert.deepEqual(
    decideGate({
      now: NOW,
      lastResponseAt: NOW - 5 * MINUTE,
      idleMinutes: 60,
      grantedAt: NOW - 10 * MINUTE,
      unlockTtlMinutes: 10,
      stepKind: 'user-send',
    }),
    { kind: 'pass', reason: 'fresh' },
  )
})

test('許可が無い失効セッションは block で経過ミリ秒を返す', () => {
  assert.deepEqual(
    decideGate(expiredInput({ lastResponseAt: NOW - 90 * MINUTE })),
    { kind: 'block', idleMs: 90 * MINUTE },
  )
})

test('許可が TTL ちょうどで応答も許可前なら有効(unlocked)', () => {
  assert.deepEqual(
    decideGate({
      now: NOW,
      lastResponseAt: NOW - 90 * MINUTE,
      idleMinutes: 60,
      grantedAt: NOW - 10 * MINUTE,
      unlockTtlMinutes: 10,
      stepKind: 'user-send',
    }),
    { kind: 'pass', reason: 'unlocked' },
  )
})

test('#7: ターン途中のステップは失効していても pass/mid-turn(許可があっても同じ)', () => {
  assert.deepEqual(decideGate(expiredInput({ stepKind: 'mid-turn' })), { kind: 'pass', reason: 'mid-turn' })
  assert.deepEqual(
    decideGate(expiredInput({ stepKind: 'mid-turn', grantedAt: NOW - MINUTE })),
    { kind: 'pass', reason: 'mid-turn' },
  )
})

test('#7: ユーザーの送信を含まない最初のステップは失効していても pass/other-input', () => {
  assert.deepEqual(decideGate(expiredInput({ stepKind: 'other-input' })), { kind: 'pass', reason: 'other-input' })
})

test('#7: 失効していなければステップの種類に関わらず pass/fresh、新規セッションは pass/no-response', () => {
  for (const stepKind of ['user-send', 'mid-turn', 'other-input'] as const) {
    assert.deepEqual(
      decideGate(expiredInput({ stepKind, lastResponseAt: NOW - 59 * MINUTE })),
      { kind: 'pass', reason: 'fresh' },
      stepKind,
    )
    assert.deepEqual(
      decideGate(expiredInput({ stepKind, lastResponseAt: undefined })),
      { kind: 'pass', reason: 'no-response' },
      stepKind,
    )
  }
})

test('classifyStep: 2 ステップ目以降は入力の出どころに関わらず mid-turn', () => {
  assert.equal(classifyStep(2, []), 'mid-turn')
  assert.equal(classifyStep(2, ['user']), 'mid-turn')
  assert.equal(classifyStep(15, ['tool-jobs']), 'mid-turn')
})

test('classifyStep: 最初のステップは user を含めば user-send', () => {
  assert.equal(classifyStep(1, ['user']), 'user-send')
  // ユーザーの送信と同じステップに他の入力が入っていても止める対象。
  assert.equal(classifyStep(1, ['tool-jobs', 'user']), 'user-send')
  assert.equal(classifyStep(1, ['user', 'skill-invocation']), 'user-send')
})

test('classifyStep: 最初のステップで user を含まなければ other-input', () => {
  const cases: ReadonlyArray<readonly string[]> = [
    [],
    ['tool-jobs'],
    ['subagent-settled'],
    ['agent-message'],
    ['goal'],
    ['schedule'],
    ['webhook'],
    ['team-message'],
    ['user-question-reply'],
    ['time-context'],
  ]
  for (const kinds of cases) {
    assert.equal(classifyStep(1, kinds), 'other-input', kinds.join(','))
  }
})

test('decideGate は入力を変更しない', () => {
  const input = Object.freeze(expiredInput({ grantedAt: NOW - 10 * MINUTE }))
  const snapshot = { ...input }
  decideGate(input)
  assert.deepEqual(input, snapshot)
})

test('isGrantValid: 許可が無ければ偽', () => {
  assert.equal(
    isGrantValid({ now: NOW, lastResponseAt: NOW - 90 * MINUTE, grantedAt: undefined, unlockTtlMinutes: 10 }),
    false,
  )
})

test('isGrantValid: TTL 境界は真、1ms 超えると偽', () => {
  assert.equal(
    isGrantValid({ now: NOW, lastResponseAt: NOW - 90 * MINUTE, grantedAt: NOW - 10 * MINUTE, unlockTtlMinutes: 10 }),
    true,
  )
  assert.equal(
    isGrantValid({
      now: NOW,
      lastResponseAt: NOW - 90 * MINUTE,
      grantedAt: NOW - 10 * MINUTE - 1,
      unlockTtlMinutes: 10,
    }),
    false,
  )
})

test('isGrantValid: 許可後に応答があったら偽(同時刻も含む)', () => {
  for (const lastResponseAt of [NOW - 5 * MINUTE, NOW - 10 * MINUTE]) {
    assert.equal(
      isGrantValid({ now: NOW, lastResponseAt, grantedAt: NOW - 10 * MINUTE, unlockTtlMinutes: 10 }),
      false,
    )
  }
})

test('isGrantValid: 時計巻き戻り(now < grantedAt)は真', () => {
  assert.equal(
    isGrantValid({
      now: NOW,
      lastResponseAt: NOW - 30 * MINUTE,
      grantedAt: NOW + 5 * MINUTE,
      unlockTtlMinutes: 10,
    }),
    true,
  )
})

test('isGrantValid: 応答が無い状態の許可は有効', () => {
  assert.equal(
    isGrantValid({ now: NOW, lastResponseAt: undefined, grantedAt: NOW - MINUTE, unlockTtlMinutes: 10 }),
    true,
  )
})

test('isGrantValid は入力を変更しない', () => {
  const input = Object.freeze({
    now: NOW,
    lastResponseAt: NOW - 90 * MINUTE,
    grantedAt: NOW - MINUTE,
    unlockTtlMinutes: 10,
  })
  const snapshot = { ...input }
  isGrantValid(input)
  assert.deepEqual(input, snapshot)
})
