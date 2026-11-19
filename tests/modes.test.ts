import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULTS } from '../src/config.ts'
import { asMode } from '../src/modes.ts'

test('asMode: 有効な文字列はそのまま Mode にする', () => {
  assert.equal(asMode('archive', DEFAULTS.mode), 'archive')
})

test('asMode: 不正な文字列は fallback を使う', () => {
  assert.equal(asMode('', DEFAULTS.mode), DEFAULTS.mode)
  assert.equal(asMode('nope', 'both'), 'both')
})
