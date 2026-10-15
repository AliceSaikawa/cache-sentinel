import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULTS, parseConfig } from '../src/config.ts'

test('DEFAULTS は仕様 §6 の既定値', () => {
  assert.deepEqual(DEFAULTS, {
    idleMinutes: 60,
    checkIntervalSeconds: 60,
    skipPinned: true,
    archiveExisting: false,
    maxPerCycle: 20,
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
  assert.deepEqual(parseConfig({ dryRun: true, maxPerCycle: 3 }), {
    ...DEFAULTS,
    dryRun: true,
    maxPerCycle: 3,
  })
})

test('全キー指定をそのまま反映する', () => {
  const config = parseConfig({
    idleMinutes: 1,
    checkIntervalSeconds: 10,
    skipPinned: false,
    archiveExisting: true,
    maxPerCycle: 1,
    dryRun: true,
    stateFile: '/tmp/state.json',
  })
  assert.deepEqual(config, {
    idleMinutes: 1,
    checkIntervalSeconds: 10,
    skipPinned: false,
    archiveExisting: true,
    maxPerCycle: 1,
    dryRun: true,
    stateFile: '/tmp/state.json',
  })
})

test('stateFile 未指定なら undefined のまま', () => {
  assert.equal(parseConfig({}).stateFile, undefined)
})

test('未知のキーは例外にする', () => {
  assert.throws(() => parseConfig({ unknown: 1 }), /unknown/)
  assert.throws(() => parseConfig({ idleMinutes: 5, typo: true }), /typo/)
})

test('オブジェクト以外は例外にする', () => {
  assert.throws(() => parseConfig('60'), /オブジェクト/)
  assert.throws(() => parseConfig(60), /オブジェクト/)
  assert.throws(() => parseConfig([]), /オブジェクト/)
})

test('型不正は例外にする(キー名を含む)', () => {
  assert.throws(() => parseConfig({ idleMinutes: '60' }), /idleMinutes/)
  assert.throws(() => parseConfig({ skipPinned: 'true' }), /skipPinned/)
  assert.throws(() => parseConfig({ archiveExisting: 1 }), /archiveExisting/)
  assert.throws(() => parseConfig({ stateFile: 42 }), /stateFile/)
})

test('有限の整数でない数値は例外にする', () => {
  assert.throws(() => parseConfig({ idleMinutes: 1.5 }), /idleMinutes/)
  assert.throws(() => parseConfig({ maxPerCycle: Number.NaN }), /maxPerCycle/)
  assert.throws(() => parseConfig({ checkIntervalSeconds: Number.POSITIVE_INFINITY }), /checkIntervalSeconds/)
})

test('範囲外は例外にする', () => {
  assert.throws(() => parseConfig({ idleMinutes: 0 }), /idleMinutes/)
  assert.throws(() => parseConfig({ idleMinutes: -1 }), /idleMinutes/)
  assert.throws(() => parseConfig({ checkIntervalSeconds: 9 }), /checkIntervalSeconds/)
  assert.throws(() => parseConfig({ maxPerCycle: 0 }), /maxPerCycle/)
})

test('境界値は受け入れる', () => {
  assert.equal(parseConfig({ idleMinutes: 1 }).idleMinutes, 1)
  assert.equal(parseConfig({ checkIntervalSeconds: 10 }).checkIntervalSeconds, 10)
  assert.equal(parseConfig({ maxPerCycle: 1 }).maxPerCycle, 1)
})

test('既定値オブジェクトを破壊しない', () => {
  const config = parseConfig({ idleMinutes: 5 })
  config.idleMinutes = 99
  assert.equal(DEFAULTS.idleMinutes, 60)
})
