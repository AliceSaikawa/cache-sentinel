import assert from 'node:assert/strict'
import test from 'node:test'

import { decideArchive, type DecideInput, type SessionInfo } from '../src/decide.ts'

const MINUTE = 60_000
const NOW = 1_700_000_000_000

/** 指定した値だけを持つセッションを作る (既定はトップレベル・未アーカイブ・未ピン)。 */
function session(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    createdAt: 0,
    pinned: false,
    archived: false,
    ...overrides,
  }
}

function decide(
  sessions: readonly SessionInfo[],
  overrides: Partial<Omit<DecideInput, 'sessions'>> = {},
): string[] {
  return decideArchive({
    sessions,
    now: NOW,
    baselineAt: 0,
    unarchivedAt: {},
    idleMinutes: 60,
    skipPinned: true,
    archiveExisting: false,
    ...overrides,
  })
}

test('59 分は対象外、ちょうど 60 分は対象外、61 分は対象 (A1/A2)', () => {
  assert.deepEqual(decide([session({ id: 'a', lastActivityAt: NOW - 59 * MINUTE })]), [])
  assert.deepEqual(decide([session({ id: 'a', lastActivityAt: NOW - 60 * MINUTE })]), [])
  assert.deepEqual(decide([session({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })]), ['a'])
})

test('しきい値はミリ秒単位で厳密に超えたときだけ対象', () => {
  assert.deepEqual(decide([session({ id: 'a', lastActivityAt: NOW - (60 * MINUTE + 1) })]), ['a'])
  assert.deepEqual(decide([session({ id: 'a', lastActivityAt: NOW - (60 * MINUTE - 1) })]), [])
})

test('idleMinutes の変更がしきい値に反映される', () => {
  const target = session({ id: 'a', lastActivityAt: NOW - 5 * MINUTE })
  assert.deepEqual(decide([target], { idleMinutes: 5 }), [])
  assert.deepEqual(decide([target], { idleMinutes: 4 }), ['a'])
})

test('lastActivityAt 未設定なら createdAt を使う (spec §2)', () => {
  assert.deepEqual(decide([session({ id: 'a', createdAt: NOW - 61 * MINUTE })]), ['a'])
  assert.deepEqual(decide([session({ id: 'a', createdAt: NOW - 59 * MINUTE })]), [])
})

test('lastActivityAt があれば createdAt より優先する', () => {
  const stale = session({ id: 'a', createdAt: NOW - 600 * MINUTE, lastActivityAt: NOW - 10 * MINUTE })
  const fresh = session({ id: 'b', createdAt: NOW - 600 * MINUTE, lastActivityAt: NOW - 61 * MINUTE })
  assert.deepEqual(decide([stale, fresh]), ['b'])
})

test('ピン留めは skipPinned のとき除外、false なら対象 (A3)', () => {
  const pinned = session({ id: 'a', lastActivityAt: NOW - 61 * MINUTE, pinned: true })
  assert.deepEqual(decide([pinned]), [])
  assert.deepEqual(decide([pinned], { skipPinned: false }), ['a'])
})

test('ピン留めでないセッションは skipPinned の値によらず対象', () => {
  const plain = session({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })
  assert.deepEqual(decide([plain]), ['a'])
  assert.deepEqual(decide([plain], { skipPinned: false }), ['a'])
})

test('subagent は除外、parentSession ありは除外 (A3)', () => {
  const subagent = session({ id: 'sub', origin: 'subagent', lastActivityAt: NOW - 600 * MINUTE })
  const child = session({ id: 'child', parentSession: 'root', lastActivityAt: NOW - 600 * MINUTE })
  const root = session({ id: 'root', lastActivityAt: NOW - 61 * MINUTE })
  assert.deepEqual(decide([subagent, child, root]), ['root'])
})

test('archived は除外', () => {
  const archived = session({ id: 'a', lastActivityAt: NOW - 600 * MINUTE, archived: true })
  const active = session({ id: 'b', lastActivityAt: NOW - 61 * MINUTE })
  assert.deepEqual(decide([archived, active]), ['b'])
})

test('archived は unarchivedAt があっても除外', () => {
  const archived = session({ id: 'a', lastActivityAt: NOW - 600 * MINUTE, archived: true })
  assert.deepEqual(decide([archived], { unarchivedAt: { a: NOW - 61 * MINUTE } }), [])
})

test('archiveExisting=false は effective < baselineAt を除外し、ちょうど一致は対象 (A4)', () => {
  const lastActivityAt = NOW - 61 * MINUTE
  assert.deepEqual(
    decide([session({ id: 'a', lastActivityAt })], { baselineAt: lastActivityAt + 1 }),
    [],
  )
  assert.deepEqual(
    decide([session({ id: 'a', lastActivityAt })], { baselineAt: lastActivityAt }),
    ['a'],
  )
})

test('archiveExisting=true なら baselineAt より前でも対象 (A4)', () => {
  const old = session({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })
  const baselineAt = NOW - 10 * MINUTE
  assert.deepEqual(decide([old], { baselineAt }), [])
  assert.deepEqual(decide([old], { baselineAt, archiveExisting: true }), ['a'])
})

test('手動解除猶予: unarchivedAt が effective を引き上げ、解除から 60 分超で対象 (A5)', () => {
  const target = session({ id: 'a', lastActivityAt: NOW - 600 * MINUTE })
  assert.deepEqual(decide([target], { unarchivedAt: { a: NOW - 30 * MINUTE } }), [])
  assert.deepEqual(decide([target], { unarchivedAt: { a: NOW - 61 * MINUTE } }), ['a'])
})

test('unarchivedAt が lastActivityAt より古ければ影響しない', () => {
  const target = session({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })
  assert.deepEqual(decide([target], { unarchivedAt: { a: NOW - 600 * MINUTE } }), ['a'])
})

test('unarchivedAt は id ごとに独立して適用される', () => {
  const a = session({ id: 'a', lastActivityAt: NOW - 600 * MINUTE })
  const b = session({ id: 'b', lastActivityAt: NOW - 600 * MINUTE })
  assert.deepEqual(decide([a, b], { unarchivedAt: { a: NOW - 30 * MINUTE } }), ['b'])
})

test('時計巻き戻り: effective が now より未来ならアイドル 0 で対象外 (§8)', () => {
  const future = session({ id: 'a', lastActivityAt: NOW + 10 * MINUTE })
  assert.deepEqual(decide([future]), [])
  assert.deepEqual(decide([future], { archiveExisting: true, skipPinned: false }), [])
})

test('時計巻き戻り: unarchivedAt が未来でも対象外 (§8)', () => {
  const target = session({ id: 'a', lastActivityAt: NOW - 600 * MINUTE })
  assert.deepEqual(decide([target], { unarchivedAt: { a: NOW + MINUTE } }), [])
})

test('effective が now と等しいときはアイドル 0 で対象外', () => {
  assert.deepEqual(decide([session({ id: 'a', lastActivityAt: NOW })]), [])
})

test('並び順はアイドルの長い順、同値は入力順', () => {
  const input = [
    session({ id: 'b', lastActivityAt: NOW - 61 * MINUTE }),
    session({ id: 'a', lastActivityAt: NOW - 120 * MINUTE }),
    session({ id: 'c', lastActivityAt: NOW - 61 * MINUTE }),
    session({ id: 'd', lastActivityAt: NOW - 90 * MINUTE }),
  ]
  assert.deepEqual(decide(input), ['a', 'd', 'b', 'c'])
})

test('unarchivedAt で短くなったアイドルが並び順に反映される', () => {
  const input = [
    session({ id: 'a', lastActivityAt: NOW - 600 * MINUTE }),
    session({ id: 'b', lastActivityAt: NOW - 100 * MINUTE }),
  ]
  assert.deepEqual(decide(input, { unarchivedAt: { a: NOW - 90 * MINUTE } }), ['b', 'a'])
})

test('対象がなければ空配列を返す', () => {
  assert.deepEqual(decide([]), [])
})

test('入力を変更しない', () => {
  const sessions = [
    session({ id: 'a', lastActivityAt: NOW - 61 * MINUTE, pinned: true }),
    session({ id: 'b', origin: 'subagent', lastActivityAt: NOW - 600 * MINUTE }),
    session({ id: 'c', lastActivityAt: NOW - 90 * MINUTE }),
  ]
  const unarchivedAt = { c: NOW - 120 * MINUTE }
  const sessionsSnapshot = structuredClone(sessions)
  const unarchivedSnapshot = structuredClone(unarchivedAt)

  const result = decide(sessions, { unarchivedAt })

  assert.deepEqual(sessions, sessionsSnapshot)
  assert.deepEqual(unarchivedAt, unarchivedSnapshot)
  assert.notEqual(result, sessions)
  result.push('mutated')
  assert.deepEqual(sessions, sessionsSnapshot)
})
