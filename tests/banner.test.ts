import assert from 'node:assert/strict'
import test from 'node:test'

import { bannerFor, parseStatus, statusUrl, UNLOCK_LABEL } from '../src/client/banner.ts'
import type { StatusLike } from '../src/client/banner.ts'

const MINUTE = 60000
const NOW = 1_700_000_000_000

function status(overrides: Partial<StatusLike> = {}): StatusLike {
  return {
    gate: true,
    state: 'fresh',
    idleMinutes: null,
    unlockExpiresAt: null,
    dryRun: false,
    ...overrides,
  }
}

test('UNLOCK_LABEL の文言', () => {
  assert.equal(UNLOCK_LABEL, '次の 1 回を許可(/unlock)')
})

test('parseStatus: 正しい 5 項目はそのまま通す', () => {
  const value = {
    mode: 'block',
    gate: true,
    state: 'stale',
    idleMinutes: 75,
    thresholdMinutes: 60,
    unlockExpiresAt: null,
    dryRun: false,
  }
  assert.deepEqual(parseStatus(value), {
    gate: true,
    state: 'stale',
    idleMinutes: 75,
    unlockExpiresAt: null,
    dryRun: false,
  })
})

test('parseStatus: 5 項目だけを持つ新しいオブジェクトを返す', () => {
  const value = status({ idleMinutes: 12, unlockExpiresAt: NOW })
  const parsed = parseStatus({ ...value, extra: 'x', mode: 'both' })
  assert.deepEqual(parsed, value)
  assert.notEqual(parsed, value)
  assert.deepEqual(Object.keys(parsed as object).sort(), [
    'dryRun',
    'gate',
    'idleMinutes',
    'state',
    'unlockExpiresAt',
  ])
})

test('parseStatus: unlockExpiresAt が数値でも通る', () => {
  assert.deepEqual(parseStatus(status({ unlockExpiresAt: NOW, idleMinutes: 0 })), {
    gate: true,
    state: 'fresh',
    idleMinutes: 0,
    unlockExpiresAt: NOW,
    dryRun: false,
  })
})

test('parseStatus: オブジェクトでなければ undefined', () => {
  assert.equal(parseStatus(undefined), undefined)
  assert.equal(parseStatus(null), undefined)
  assert.equal(parseStatus(42), undefined)
  assert.equal(parseStatus('stale'), undefined)
  assert.equal(parseStatus(true), undefined)
  assert.equal(parseStatus([]), undefined)
})

test('parseStatus: gate が boolean でなければ undefined', () => {
  assert.equal(parseStatus({ ...status(), gate: 'true' }), undefined)
  assert.equal(parseStatus({ ...status(), gate: 1 }), undefined)
  assert.equal(parseStatus({ ...status(), gate: undefined }), undefined)
})

test('parseStatus: dryRun が boolean でなければ undefined', () => {
  assert.equal(parseStatus({ ...status(), dryRun: 'false' }), undefined)
  assert.equal(parseStatus({ ...status(), dryRun: 0 }), undefined)
  assert.equal(parseStatus({ ...status(), dryRun: undefined }), undefined)
})

test('parseStatus: state が文字列でなければ undefined', () => {
  assert.equal(parseStatus({ ...status(), state: 3 }), undefined)
  assert.equal(parseStatus({ ...status(), state: null }), undefined)
  assert.equal(parseStatus({ ...status(), state: undefined }), undefined)
})

test('parseStatus: idleMinutes は有限数か null のみ', () => {
  assert.equal(parseStatus({ ...status(), idleMinutes: 75 })?.idleMinutes, 75)
  assert.equal(parseStatus({ ...status(), idleMinutes: null })?.idleMinutes, null)
  assert.equal(parseStatus({ ...status(), idleMinutes: '75' }), undefined)
  assert.equal(parseStatus({ ...status(), idleMinutes: Number.NaN }), undefined)
  assert.equal(parseStatus({ ...status(), idleMinutes: Number.POSITIVE_INFINITY }), undefined)
  assert.equal(parseStatus({ ...status(), idleMinutes: Number.NEGATIVE_INFINITY }), undefined)
  assert.equal(parseStatus({ ...status(), idleMinutes: undefined }), undefined)
})

test('parseStatus: unlockExpiresAt は有限数か null のみ', () => {
  assert.equal(parseStatus({ ...status(), unlockExpiresAt: NOW })?.unlockExpiresAt, NOW)
  assert.equal(parseStatus({ ...status(), unlockExpiresAt: null })?.unlockExpiresAt, null)
  assert.equal(parseStatus({ ...status(), unlockExpiresAt: '0' }), undefined)
  assert.equal(parseStatus({ ...status(), unlockExpiresAt: Number.NaN }), undefined)
  assert.equal(parseStatus({ ...status(), unlockExpiresAt: Number.POSITIVE_INFINITY }), undefined)
  assert.equal(parseStatus({ ...status(), unlockExpiresAt: undefined }), undefined)
})

test('parseStatus: 項目が欠けていれば undefined', () => {
  assert.equal(parseStatus({ state: 'fresh', idleMinutes: null, dryRun: false }), undefined)
})

test('bannerFor: status が無ければ undefined', () => {
  assert.equal(bannerFor(undefined, NOW), undefined)
})

test('bannerFor: gate が偽なら undefined', () => {
  assert.equal(bannerFor(status({ gate: false, state: 'stale' }), NOW), undefined)
  assert.equal(bannerFor(status({ gate: false, state: 'unlocked' }), NOW), undefined)
})

test('bannerFor: stale かつ dryRun でない → 警告と unlock ボタン', () => {
  assert.deepEqual(bannerFor(status({ state: 'stale', idleMinutes: 75 }), NOW), {
    tone: 'warning',
    text: 'キャッシュ切れ(最終応答から 75 分)。このまま送ると止められます。',
    action: 'unlock',
  })
})

test('bannerFor: stale で idleMinutes が null → 括弧を出さない', () => {
  assert.deepEqual(bannerFor(status({ state: 'stale', idleMinutes: null }), NOW), {
    tone: 'warning',
    text: 'キャッシュ切れ。このまま送ると止められます。',
    action: 'unlock',
  })
})

test('bannerFor: stale でも dryRun なら undefined', () => {
  assert.equal(bannerFor(status({ state: 'stale', idleMinutes: 75, dryRun: true }), NOW), undefined)
})

test('bannerFor: unlocked で期限が数値 → 残り分を出す', () => {
  assert.deepEqual(bannerFor(status({ state: 'unlocked', unlockExpiresAt: NOW + 5 * MINUTE }), NOW), {
    tone: 'info',
    text: '次の送信を許可中(キャッシュなしの料金になります)。あと 5 分',
  })
})

test('bannerFor: unlocked の残り分は切り上げる', () => {
  assert.deepEqual(bannerFor(status({ state: 'unlocked', unlockExpiresAt: NOW + 1 }), NOW), {
    tone: 'info',
    text: '次の送信を許可中(キャッシュなしの料金になります)。あと 1 分',
  })
  assert.deepEqual(bannerFor(status({ state: 'unlocked', unlockExpiresAt: NOW + 60_001 }), NOW), {
    tone: 'info',
    text: '次の送信を許可中(キャッシュなしの料金になります)。あと 2 分',
  })
})

test('bannerFor: unlocked の残り分は 0 未満にしない', () => {
  assert.deepEqual(bannerFor(status({ state: 'unlocked', unlockExpiresAt: NOW - 5 * MINUTE }), NOW), {
    tone: 'info',
    text: '次の送信を許可中(キャッシュなしの料金になります)。あと 0 分',
  })
})

test('bannerFor: unlocked で期限が null → 「あと…」を出さない', () => {
  assert.deepEqual(bannerFor(status({ state: 'unlocked', unlockExpiresAt: null }), NOW), {
    tone: 'info',
    text: '次の送信を許可中(キャッシュなしの料金になります)。',
  })
})

test('bannerFor: それ以外の state は undefined', () => {
  for (const state of ['inactive', 'unknown', 'no-response', 'fresh', 'unlocked?']) {
    assert.equal(bannerFor(status({ state }), NOW), undefined, state)
  }
})

test('statusUrl: base に api パスと sessionId を付ける', () => {
  assert.equal(
    statusUrl('https://x.example/ui/', 'ses-1'),
    'https://x.example/ui/api/cache-sentinel.status?sessionId=ses-1',
  )
})

test('statusUrl: sessionId をエンコードする', () => {
  assert.equal(
    statusUrl('https://x.example/ui/', 'a b&c=d/é'),
    'https://x.example/ui/api/cache-sentinel.status?sessionId=a+b%26c%3Dd%2F%C3%A9',
  )
})

test('statusUrl: 末尾スラッシュ無しの base でも動く', () => {
  assert.equal(
    statusUrl('https://x.example/ui', 'ses-1'),
    'https://x.example/api/cache-sentinel.status?sessionId=ses-1',
  )
})
