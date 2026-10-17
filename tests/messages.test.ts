import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCALES } from '../src/i18n.ts'
import { MESSAGES } from '../src/messages.ts'

test('MESSAGES: 3 言語でキーが揃っている', () => {
  const base = Object.keys(MESSAGES.en).sort()
  assert.ok(base.length > 0)
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(MESSAGES[locale]).sort(), base, locale)
  }
})

test('MESSAGES: 3 言語で値の型と引数の数が揃っている', () => {
  for (const locale of LOCALES) {
    const dict = MESSAGES[locale] as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(MESSAGES.en) as Array<[string, unknown]>) {
      const other = dict[key]
      assert.equal(typeof other, typeof value, `${locale}.${key}`)
      if (typeof value === 'function' && typeof other === 'function') {
        assert.equal(other.length, value.length, `${locale}.${key}`)
      }
    }
  }
})

test('MESSAGES.ja: コマンドの説明はこれまでの文言と同じ', () => {
  assert.equal(
    MESSAGES.ja.commandUnlockDescription,
    'キャッシュ切れで入力禁止のセッションで、次の送信を許可する(cache-sentinel)',
  )
  assert.equal(
    MESSAGES.ja.commandSentinelDescription,
    'cache-sentinel の状態表示とモード切り替え: /sentinel [block|archive|both|off|default]',
  )
})
