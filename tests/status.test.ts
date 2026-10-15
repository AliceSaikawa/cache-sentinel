import assert from 'node:assert/strict'
import test from 'node:test'

import { computeStatus } from '../src/status.ts'

const MINUTE = 60000
const NOW = 1_700_000_000_000

/** 失効中(経過 > idleMinutes)の入力を作る補助。 */
function expiredInput(overrides: Partial<Parameters<typeof computeStatus>[0]> = {}) {
  return {
    mode: 'block',
    gate: true,
    known: true,
    now: NOW,
    lastResponseAt: NOW - 90 * MINUTE,
    idleMinutes: 60,
    grantedAt: undefined,
    unlockTtlMinutes: 10,
    dryRun: false,
    ...overrides,
  }
}

test('gate が偽なら inactive、thresholdMinutes は idleMinutes', () => {
  assert.deepEqual(
    computeStatus(expiredInput({ gate: false })),
    {
      mode: 'block',
      gate: false,
      state: 'inactive',
      idleMinutes: 90,
      thresholdMinutes: 60,
      unlockExpiresAt: null,
      dryRun: false,
    },
  )
})

test('inactive は known かつ応答があるときだけ経過分を出す', () => {
  assert.equal(
    computeStatus(expiredInput({ gate: false, known: false })).idleMinutes,
    null,
  )
  assert.equal(
    computeStatus(expiredInput({ gate: false, lastResponseAt: undefined })).idleMinutes,
    null,
  )
})

test('inactive は gate と関係なく unknown より優先する', () => {
  assert.equal(
    computeStatus(expiredInput({ gate: false, known: false })).state,
    'inactive',
  )
})

test('inactive でも巻き戻りは経過 0', () => {
  assert.equal(
    computeStatus(expiredInput({ gate: false, lastResponseAt: NOW + 5 * MINUTE })).idleMinutes,
    0,
  )
})

test('gate 真で known 偽なら unknown(idleMinutes は null)', () => {
  assert.deepEqual(
    computeStatus(expiredInput({ known: false })),
    {
      mode: 'block',
      gate: true,
      state: 'unknown',
      idleMinutes: null,
      thresholdMinutes: 60,
      unlockExpiresAt: null,
      dryRun: false,
    },
  )
})

test('応答がまだ無ければ no-response(idleMinutes は null)', () => {
  assert.deepEqual(
    computeStatus(expiredInput({ lastResponseAt: undefined })),
    {
      mode: 'block',
      gate: true,
      state: 'no-response',
      idleMinutes: null,
      thresholdMinutes: 60,
      unlockExpiresAt: null,
      dryRun: false,
    },
  )
})

test('失効していなければ fresh(経過分は切り捨て)', () => {
  assert.deepEqual(
    computeStatus(expiredInput({ lastResponseAt: NOW - 59 * MINUTE - 30_000 })),
    {
      mode: 'block',
      gate: true,
      state: 'fresh',
      idleMinutes: 59,
      thresholdMinutes: 60,
      unlockExpiresAt: null,
      dryRun: false,
    },
  )
})

test('境界: ちょうど閾値は fresh、1ms 超えると stale', () => {
  assert.equal(
    computeStatus(expiredInput({ lastResponseAt: NOW - 60 * MINUTE })).state,
    'fresh',
  )
  assert.deepEqual(
    computeStatus(expiredInput({ lastResponseAt: NOW - 60 * MINUTE - 1 })),
    {
      mode: 'block',
      gate: true,
      state: 'stale',
      idleMinutes: 60,
      thresholdMinutes: 60,
      unlockExpiresAt: null,
      dryRun: false,
    },
  )
})

test('時計巻き戻りは経過 0 として fresh', () => {
  assert.deepEqual(
    computeStatus(expiredInput({ lastResponseAt: NOW + 5 * MINUTE })),
    {
      mode: 'block',
      gate: true,
      state: 'fresh',
      idleMinutes: 0,
      thresholdMinutes: 60,
      unlockExpiresAt: null,
      dryRun: false,
    },
  )
})

test('失効中で有効な解除許可があれば unlocked と期限を返す', () => {
  assert.deepEqual(
    computeStatus(expiredInput({ grantedAt: NOW - 2 * MINUTE, unlockTtlMinutes: 10 })),
    {
      mode: 'block',
      gate: true,
      state: 'unlocked',
      idleMinutes: 90,
      thresholdMinutes: 60,
      unlockExpiresAt: NOW - 2 * MINUTE + 10 * MINUTE,
      dryRun: false,
    },
  )
})

test('許可が TTL を過ぎていれば stale', () => {
  assert.equal(
    computeStatus(expiredInput({ grantedAt: NOW - 10 * MINUTE - 1 })).state,
    'stale',
  )
})

test('許可後に応答があれば無効で stale', () => {
  assert.equal(
    computeStatus(
      expiredInput({ grantedAt: NOW - 90 * MINUTE, lastResponseAt: NOW - 80 * MINUTE }),
    ).state,
    'stale',
  )
})

test('fresh のときは許可があっても fresh(許可は失効時のみ)', () => {
  assert.equal(
    computeStatus(
      expiredInput({ grantedAt: NOW - 5 * MINUTE, lastResponseAt: NOW - 30 * MINUTE }),
    ).state,
    'fresh',
  )
})

test('mode と dryRun はそのまま写す', () => {
  const result = computeStatus(expiredInput({ mode: 'both', dryRun: true }))
  assert.equal(result.mode, 'both')
  assert.equal(result.dryRun, true)
})

test('computeStatus は入力を変更しない', () => {
  const input = Object.freeze(expiredInput({ grantedAt: NOW - 2 * MINUTE }))
  const snapshot = { ...input }
  computeStatus(input)
  assert.deepEqual(input, snapshot)
})
