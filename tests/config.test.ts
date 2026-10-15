import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULTS, parseConfig } from '../src/config.ts'
import { MODES } from '../src/modes.ts'

/** 整数キーとその下限 (spec §6)。 */
const INTEGER_KEYS: ReadonlyArray<readonly [string, number]> = [
  ['idleMinutes', 1],
  ['archiveAfterMinutes', 1],
  ['unlockTtlMinutes', 1],
  ['checkIntervalSeconds', 10],
  ['maxPerCycle', 1],
]

const BOOLEAN_KEYS = ['skipPinned', 'archiveExisting', 'dryRun'] as const

test('DEFAULTS は仕様 §6 の既定値', () => {
  assert.deepEqual(DEFAULTS, {
    mode: 'block',
    idleMinutes: 60,
    archiveAfterMinutes: 1440,
    unlockTtlMinutes: 10,
    checkIntervalSeconds: 60,
    skipPinned: true,
    archiveExisting: false,
    maxPerCycle: 20,
    dryRun: false,
  })
})

test('DEFAULTS は stateFile を持たない(未指定は省略可)', () => {
  assert.equal('stateFile' in DEFAULTS, false)
})

test('undefined / null / {} は既定値で返す', () => {
  for (const raw of [undefined, null, {}]) {
    assert.deepEqual(parseConfig(raw), { ...DEFAULTS })
  }
})

test('未指定なら stateFile キーを持たない', () => {
  assert.equal('stateFile' in parseConfig(undefined), false)
  assert.equal('stateFile' in parseConfig({ dryRun: true }), false)
})

test('部分指定は既定値で補完する(整数キー)', () => {
  for (const [key, min] of INTEGER_KEYS) {
    assert.deepEqual(parseConfig({ [key]: min }), { ...DEFAULTS, [key]: min })
  }
})

test('部分指定は既定値で補完する(boolean キー)', () => {
  for (const key of BOOLEAN_KEYS) {
    assert.deepEqual(parseConfig({ [key]: false }), { ...DEFAULTS, [key]: false })
  }
})

test('部分指定は既定値で補完する(mode / stateFile)', () => {
  assert.deepEqual(parseConfig({ mode: 'archive' }), { ...DEFAULTS, mode: 'archive' })
  assert.deepEqual(parseConfig({ stateFile: '/tmp/state.json' }), {
    ...DEFAULTS,
    stateFile: '/tmp/state.json',
  })
})

test('mode は MODES の全値をそのまま反映する', () => {
  assert.deepEqual(MODES, ['block', 'archive', 'both', 'off'])
  for (const mode of MODES) {
    assert.equal(parseConfig({ mode }).mode, mode)
  }
})

test('全キー指定をそのまま反映する', () => {
  const raw = {
    mode: 'both',
    idleMinutes: 1,
    archiveAfterMinutes: 2880,
    unlockTtlMinutes: 30,
    checkIntervalSeconds: 10,
    skipPinned: false,
    archiveExisting: true,
    maxPerCycle: 5,
    dryRun: true,
    stateFile: '/var/state.json',
  }
  assert.deepEqual(parseConfig(raw), raw)
})

test('未知のキーは例外にする(キー名を含む)', () => {
  assert.throws(() => parseConfig({ unknown: 1 }), /unknown/)
  assert.throws(() => parseConfig({ idleMinutes: 5, typo: true }), /typo/)
  assert.throws(() => parseConfig({ Mode: 'both' }), /Mode/)
  assert.throws(() => parseConfig({ idle_minutes: 5 }), /idle_minutes/)
})

test('オブジェクト以外は例外にする', () => {
  assert.throws(() => parseConfig('60'), /オブジェクト/)
  assert.throws(() => parseConfig(60), /オブジェクト/)
  assert.throws(() => parseConfig([]), /オブジェクト/)
  assert.throws(() => parseConfig(true), /オブジェクト/)
})

test('mode が MODES 以外なら例外にする(使える値を列挙)', () => {
  for (const value of ['Block', 'none', '', true, 1, null]) {
    assert.throws(() => parseConfig({ mode: value }), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /mode/)
      for (const usable of MODES) {
        assert.match(error.message, new RegExp(usable))
      }
      return true
    })
  }
})

test('整数キーの型不正は例外にする(キー名を含む)', () => {
  for (const [key] of INTEGER_KEYS) {
    assert.throws(() => parseConfig({ [key]: '60' }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: null }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: true }), new RegExp(key))
  }
})

test('boolean キーの型不正は例外にする(キー名を含む)', () => {
  for (const key of BOOLEAN_KEYS) {
    assert.throws(() => parseConfig({ [key]: 'true' }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: 1 }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: null }), new RegExp(key))
  }
})

test('stateFile は文字列以外を例外にする(キー名を含む)', () => {
  for (const value of [1, true, null, {}, []]) {
    assert.throws(() => parseConfig({ stateFile: value }), /stateFile/)
  }
  assert.equal(parseConfig({ stateFile: '' }).stateFile, '')
})

test('有限の整数でない数値は例外にする(キー名を含む)', () => {
  for (const [key] of INTEGER_KEYS) {
    assert.throws(() => parseConfig({ [key]: 1.5 }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: Number.NaN }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: Number.POSITIVE_INFINITY }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: Number.NEGATIVE_INFINITY }), new RegExp(key))
  }
})

test('範囲外は例外にする(キー名を含む)', () => {
  for (const [key, min] of INTEGER_KEYS) {
    assert.throws(() => parseConfig({ [key]: min - 1 }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: 0 }), new RegExp(key))
    assert.throws(() => parseConfig({ [key]: -5 }), new RegExp(key))
  }
})

test('checkIntervalSeconds は 10 未満を例外にする', () => {
  assert.throws(() => parseConfig({ checkIntervalSeconds: 9 }), /checkIntervalSeconds/)
})

test('境界値(下限ちょうど)は受け入れる', () => {
  for (const [key, min] of INTEGER_KEYS) {
    assert.equal(parseConfig({ [key]: min })[key as keyof typeof DEFAULTS], min)
  }
})

test('既定値オブジェクトを破壊しない', () => {
  const config = parseConfig({ idleMinutes: 5, mode: 'off' })
  config.idleMinutes = 99
  config.mode = 'both'
  assert.equal(DEFAULTS.idleMinutes, 60)
  assert.equal(DEFAULTS.mode, 'block')
})
