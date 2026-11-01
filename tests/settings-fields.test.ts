/** #10: 設定ページの欄と、入力文字列 ⇄ 保存する値の変換 (src/client/settings-fields.ts)。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { booleanField, fieldSpecs, integerField, modeField, SETTINGS_FIELDS } from '../src/client/settings-fields.ts'
import { CONFIG_KEYS } from '../src/config.ts'
import { LOCALES } from '../src/i18n.ts'
import { MESSAGES } from '../src/messages.ts'
import { MODES } from '../src/modes.ts'

test('#10: 設定ページの欄は CONFIG_KEYS の live なキーと同じ並び(stateFile は出さない)', () => {
  assert.deepEqual(
    SETTINGS_FIELDS.map((field) => field.key),
    CONFIG_KEYS.filter((spec) => spec.live).map((spec) => spec.key),
  )
  assert.deepEqual(
    fieldSpecs().map((spec) => spec.field),
    SETTINGS_FIELDS.map((field) => field.key),
  )
  for (const field of SETTINGS_FIELDS) {
    const spec = CONFIG_KEYS.find((candidate) => candidate.key === field.key)
    assert.equal(field.kind, spec?.kind, field.key)
    if (field.kind === 'integer' && spec?.kind === 'integer') assert.equal(field.min, spec.min, field.key)
  }
})

test('#10: 整数の欄は下限以上の整数だけを受け付け、空欄は既定値に戻す', () => {
  const spec = integerField('checkIntervalSeconds', 10)
  assert.equal(spec.format(60), '60')
  assert.equal(spec.format(undefined), '')
  assert.deepEqual(spec.parse('10'), { kind: 'set', value: 10 })
  assert.deepEqual(spec.parse(' 120 '), { kind: 'set', value: 120 })
  assert.deepEqual(spec.parse(''), { kind: 'clear' })
  assert.deepEqual(spec.parse('  '), { kind: 'clear' })
  for (const bad of ['9', '0', '-1', '1.5', '10.0', '1e2', '0x10', 'abc', '９９', '99999999999999999999']) {
    assert.equal(spec.parse(bad), undefined, `${bad} は不正`)
  }
})

test('#10: on/off の欄は true / false を boolean にする', () => {
  const spec = booleanField('dryRun')
  assert.equal(spec.format(true), 'true')
  assert.equal(spec.format(false), 'false')
  assert.deepEqual(spec.parse('true'), { kind: 'set', value: true })
  assert.deepEqual(spec.parse('false'), { kind: 'set', value: false })
  assert.equal(spec.parse('yes'), undefined)
})

test('#10: モードの欄は MODES のどれかだけを受け付ける', () => {
  const spec = modeField('mode')
  for (const mode of MODES) {
    assert.equal(spec.format(mode), mode)
    assert.deepEqual(spec.parse(mode), { kind: 'set', value: mode })
  }
  assert.equal(spec.format('none'), '')
  assert.equal(spec.parse('Block'), undefined)
})

test('#10: 設定ページの文言は 3 言語とも全欄にある', () => {
  for (const locale of LOCALES) {
    const m = MESSAGES[locale]
    for (const field of SETTINGS_FIELDS) {
      assert.ok(m.settingsLabels[field.key].length > 0, `${locale} ${field.key} の見出し`)
      assert.ok(m.settingsHints[field.key].length > 0, `${locale} ${field.key} の説明`)
    }
    for (const mode of MODES) assert.ok(m.settingsModeOptions[mode].length > 0, `${locale} ${mode}`)
    assert.match(m.settingsInvalidInteger(10), /10/)
  }
})
