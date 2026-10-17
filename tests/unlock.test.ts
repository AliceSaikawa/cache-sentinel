import assert from 'node:assert/strict'
import test from 'node:test'

import { decideUnlock, UnlockStore, unlockMessage } from '../src/unlock.ts'

const MINUTE = 60000
const NOW = 1_700_000_000_000

test('grant したセッションの grantedAt を返す', () => {
  const store = new UnlockStore()
  store.grant('s1', NOW)
  assert.equal(store.grantedAt('s1'), NOW)
})

test('許可の無いセッションの grantedAt は undefined', () => {
  const store = new UnlockStore()
  assert.equal(store.grantedAt('s1'), undefined)
})

test('grant は同じセッションの許可を上書きする', () => {
  const store = new UnlockStore()
  store.grant('s1', NOW)
  store.grant('s1', NOW + MINUTE)
  assert.equal(store.grantedAt('s1'), NOW + MINUTE)
})

test('grant はセッションごとに独立している', () => {
  const store = new UnlockStore()
  store.grant('s1', NOW)
  store.grant('s2', NOW + MINUTE)
  assert.equal(store.grantedAt('s1'), NOW)
  assert.equal(store.grantedAt('s2'), NOW + MINUTE)
})

test('revoke は許可を消す', () => {
  const store = new UnlockStore()
  store.grant('s1', NOW)
  store.revoke('s1')
  assert.equal(store.grantedAt('s1'), undefined)
})

test('revoke は許可の無いセッションでも何もしない', () => {
  const store = new UnlockStore()
  store.revoke('s1')
  assert.equal(store.grantedAt('s1'), undefined)
})

test('prune は TTL を過ぎた許可だけを消す(境界ちょうどは残す)', () => {
  const store = new UnlockStore()
  store.grant('boundary', NOW - 10 * MINUTE) // ちょうど TTL
  store.grant('expired', NOW - 10 * MINUTE - 1) // 1ms 超過
  store.grant('alive', NOW - 5 * MINUTE)

  store.prune(NOW, 10 * MINUTE)

  assert.equal(store.grantedAt('boundary'), NOW - 10 * MINUTE)
  assert.equal(store.grantedAt('expired'), undefined)
  assert.equal(store.grantedAt('alive'), NOW - 5 * MINUTE)
})

test('prune は時計巻き戻り(負の経過)の許可を残す', () => {
  const store = new UnlockStore()
  store.grant('future', NOW + 5 * MINUTE)
  store.prune(NOW, 10 * MINUTE)
  assert.equal(store.grantedAt('future'), NOW + 5 * MINUTE)
})

test('decideUnlock: 応答が無ければ no-response', () => {
  assert.deepEqual(
    decideUnlock({ now: NOW, lastResponseAt: undefined, idleMinutes: 60, unlockTtlMinutes: 10 }),
    { kind: 'no-response' },
  )
})

test('decideUnlock: 失効していなければ fresh', () => {
  assert.deepEqual(
    decideUnlock({
      now: NOW,
      lastResponseAt: NOW - 59 * MINUTE,
      idleMinutes: 60,
      unlockTtlMinutes: 10,
    }),
    { kind: 'fresh', idleMinutes: 59 },
  )
})

test('decideUnlock の境界: ちょうど idleMinutes は fresh、1ms 超えると granted', () => {
  assert.deepEqual(
    decideUnlock({
      now: NOW,
      lastResponseAt: NOW - 60 * MINUTE,
      idleMinutes: 60,
      unlockTtlMinutes: 10,
    }),
    { kind: 'fresh', idleMinutes: 60 },
  )
  assert.deepEqual(
    decideUnlock({
      now: NOW,
      lastResponseAt: NOW - 60 * MINUTE - 1,
      idleMinutes: 60,
      unlockTtlMinutes: 10,
    }),
    { kind: 'granted', idleMinutes: 60, ttlMinutes: 10 },
  )
})

test('decideUnlock: 失効していれば granted で ttlMinutes を返す', () => {
  assert.deepEqual(
    decideUnlock({
      now: NOW,
      lastResponseAt: NOW - 90 * MINUTE,
      idleMinutes: 60,
      unlockTtlMinutes: 10,
    }),
    { kind: 'granted', idleMinutes: 90, ttlMinutes: 10 },
  )
})

test('decideUnlock: 経過は分に切り捨てる(fresh / granted の両方)', () => {
  // 59.99 分 → 59 分(fresh)
  assert.deepEqual(
    decideUnlock({
      now: NOW,
      lastResponseAt: NOW - 59 * MINUTE - 59_999,
      idleMinutes: 60,
      unlockTtlMinutes: 10,
    }),
    { kind: 'fresh', idleMinutes: 59 },
  )
  // 90.99 分 → 90 分(granted)
  assert.deepEqual(
    decideUnlock({
      now: NOW,
      lastResponseAt: NOW - 90 * MINUTE - 59_999,
      idleMinutes: 60,
      unlockTtlMinutes: 10,
    }),
    { kind: 'granted', idleMinutes: 90, ttlMinutes: 10 },
  )
})

test('decideUnlock: 時計巻き戻り(lastResponseAt > now)は経過 0 の fresh', () => {
  assert.deepEqual(
    decideUnlock({
      now: NOW,
      lastResponseAt: NOW + 5 * MINUTE,
      idleMinutes: 60,
      unlockTtlMinutes: 10,
    }),
    { kind: 'fresh', idleMinutes: 0 },
  )
})

test('decideUnlock は入力を変更しない', () => {
  const input = Object.freeze({
    now: NOW,
    lastResponseAt: NOW - 90 * MINUTE,
    idleMinutes: 60,
    unlockTtlMinutes: 10,
  })
  const snapshot = { ...input }
  decideUnlock(input)
  assert.deepEqual(input, snapshot)
})

test('unlockMessage: granted の文言', () => {
  assert.equal(
    unlockMessage({ kind: 'granted', idleMinutes: 90, ttlMinutes: 10 }, 'ja'),
    '次の送信を許可しました。最終応答から 90 分経過しているため、キャッシュなしの料金になります(許可は 10 分有効)',
  )
})

test('unlockMessage: fresh の文言', () => {
  assert.equal(
    unlockMessage({ kind: 'fresh', idleMinutes: 42 }, 'ja'),
    '最終応答から 42 分です。キャッシュは有効なのでそのまま送信できます',
  )
})

test('unlockMessage: no-response の文言', () => {
  assert.equal(
    unlockMessage({ kind: 'no-response' }, 'ja'),
    'このセッションはまだモデル応答がありません',
  )
})

// --- 表示言語 (spec-ui v0.5 §F) ---

test('unlockMessage: 英語の文面', () => {
  assert.equal(
    unlockMessage({ kind: 'granted', idleMinutes: 90, ttlMinutes: 10 }, 'en'),
    'Allowed the next send. 90 minutes have passed since the last response, so uncached input rates apply (valid for 10 minutes)',
  )
})

test('unlockMessage: 中国語の文面', () => {
  assert.equal(
    unlockMessage({ kind: 'granted', idleMinutes: 90, ttlMinutes: 10 }, 'zh-CN'),
    '已允许下一次发送。距最后一次响应已过 90 分钟，因此将按无缓存价格计费(许可 10 分钟内有效)',
  )
})
