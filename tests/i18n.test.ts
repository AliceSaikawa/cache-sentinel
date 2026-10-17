import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCALES, resolveLocale } from '../src/i18n.ts'

test('resolveLocale: ja 系は ja、エンコーディングと地域は無視する', () => {
  assert.equal(resolveLocale(['ja_JP.UTF-8']), 'ja')
  assert.equal(resolveLocale(['ja']), 'ja')
  assert.equal(resolveLocale(['ja-JP']), 'ja')
  assert.equal(resolveLocale(['ja_JP.UTF-8@euro']), 'ja')
})

test('resolveLocale: zh 系は zh-CN', () => {
  assert.equal(resolveLocale(['zh_TW.UTF-8']), 'zh-CN')
  assert.equal(resolveLocale(['zh']), 'zh-CN')
  assert.equal(resolveLocale(['zh-Hans-CN']), 'zh-CN')
})

test('resolveLocale: en 系は en', () => {
  assert.equal(resolveLocale(['en_US.UTF-8']), 'en')
  assert.equal(resolveLocale(['en']), 'en')
  assert.equal(resolveLocale(['en-GB']), 'en')
})

test('resolveLocale: 空・C・POSIX は飛ばして次の候補を見る', () => {
  assert.equal(resolveLocale([undefined, '', 'C', 'zh_TW.UTF-8']), 'zh-CN')
  assert.equal(resolveLocale(['C.UTF-8', 'ja']), 'ja')
  assert.equal(resolveLocale(['', 'POSIX', 'en_US']), 'en')
  assert.equal(resolveLocale(['   ', 'ja']), 'ja')
})

test('resolveLocale: 最初に見つかった候補で決める', () => {
  assert.equal(resolveLocale(['ja_JP', 'zh_TW']), 'ja')
  assert.equal(resolveLocale(['zh_TW', 'ja_JP']), 'zh-CN')
})

test('resolveLocale: 未対応の言語と候補なしは en', () => {
  assert.equal(resolveLocale(['fr_FR']), 'en')
  assert.equal(resolveLocale(['de']), 'en')
  assert.equal(resolveLocale([]), 'en')
  assert.equal(resolveLocale([undefined, '', 'C', 'POSIX']), 'en')
})

test('LOCALES: 対応する 3 言語', () => {
  assert.deepEqual(LOCALES, ['en', 'ja', 'zh-CN'])
})
