import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULTS, parseConfig } from '../src/config.ts'

test('DEFAULTS は仕様 §6 の既定値', () => {
  assert.deepEqual(DEFAULTS, {
    idleMinutes: 60,
    unlockTtlMinutes: 10,
    dryRun: false,
  })
})

test('undefined / null / {} は既定値で返す', () => {
  for (const raw of [undefined, null, {}]) {
    assert.deepEqual(parseConfig(raw), { ...DEFAULTS })
  }
})

test('部分指定は既定値で補完する', () => {
  assert.deepEqual(parseConfig({ idleMinutes: 5 }), {
    ...DEFAULTS,
    idleMinutes: 5,
  })
  assert.deepEqual(parseConfig({ dryRun: true, unlockTtlMinutes: 3 }), {
    ...DEFAULTS,
    dryRun: true,
    unlockTtlMinutes: 3,
  })
})

test('全キー指定をそのまま反映する', () => {
  const config = parseConfig({
    idleMinutes: 1,
    unlockTtlMinutes: 30,
    dryRun: true,
  })
  assert.deepEqual(config, {
    idleMinutes: 1,
    unlockTtlMinutes: 30,
    dryRun: true,
  })
})

test('未知のキーは例外にする', () => {
  assert.throws(() => parseConfig({ unknown: 1 }), /unknown/)
  assert.throws(() => parseConfig({ idleMinutes: 5, typo: true }), /typo/)
})

test('旧方式のキーは未知のキーとして例外にする', () => {
  const legacyKeys = [
    'checkIntervalSeconds',
    'skipPinned',
    'archiveExisting',
    'maxPerCycle',
    'stateFile',
  ]
  for (const key of legacyKeys) {
    assert.throws(() => parseConfig({ [key]: 1 }), new RegExp(key), key)
  }
})

test('オブジェクト以外は例外にする', () => {
  assert.throws(() => parseConfig('60'), /オブジェクト/)
  assert.throws(() => parseConfig(60), /オブジェクト/)
  assert.throws(() => parseConfig([]), /オブジェクト/)
})

test('型不正は例外にする(キー名を含む)', () => {
  assert.throws(() => parseConfig({ idleMinutes: '60' }), /idleMinutes/)
  assert.throws(() => parseConfig({ unlockTtlMinutes: '10' }), /unlockTtlMinutes/)
  assert.throws(() => parseConfig({ dryRun: 'true' }), /dryRun/)
})

test('有限の整数でない数値は例外にする', () => {
  assert.throws(() => parseConfig({ idleMinutes: 1.5 }), /idleMinutes/)
  assert.throws(() => parseConfig({ unlockTtlMinutes: Number.NaN }), /unlockTtlMinutes/)
  assert.throws(() => parseConfig({ idleMinutes: Number.POSITIVE_INFINITY }), /idleMinutes/)
})

test('範囲外は例外にする', () => {
  assert.throws(() => parseConfig({ idleMinutes: 0 }), /idleMinutes/)
  assert.throws(() => parseConfig({ idleMinutes: -1 }), /idleMinutes/)
  assert.throws(() => parseConfig({ unlockTtlMinutes: 0 }), /unlockTtlMinutes/)
  assert.throws(() => parseConfig({ unlockTtlMinutes: -5 }), /unlockTtlMinutes/)
})

test('境界値は受け入れる', () => {
  assert.equal(parseConfig({ idleMinutes: 1 }).idleMinutes, 1)
  assert.equal(parseConfig({ unlockTtlMinutes: 1 }).unlockTtlMinutes, 1)
})

test('既定値オブジェクトを破壊しない', () => {
  const config = parseConfig({ idleMinutes: 5 })
  config.idleMinutes = 99
  assert.equal(DEFAULTS.idleMinutes, 60)
})
