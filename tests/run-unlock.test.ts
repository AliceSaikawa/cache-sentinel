import assert from 'node:assert/strict'
import test from 'node:test'

import { runUnlock } from '../src/client/run-unlock.ts'

test('runUnlock: コマンドが実行されたら失敗の文面を出さない', async () => {
  assert.equal(await runUnlock(async () => ({ ok: true, value: { result: { kind: 'success' } } }), 'ja'), undefined)
})

test('runUnlock: コマンドの結果が error でも、会話に出るので失敗の文面を出さない', async () => {
  const result = { ok: true, value: { result: { kind: 'error', text: '入力禁止は無効です(モード: off)' } } }
  assert.equal(await runUnlock(async () => result, 'ja'), undefined)
})

test('runUnlock: ok: false なら Remote のエラーコードと文面を出す', async () => {
  const result = { ok: false, error: { code: 'gateway/internal', message: 'boom' } }
  assert.equal(
    await runUnlock(async () => result, 'ja'),
    '/unlock を実行できませんでした(gateway/internal: boom)。入力欄から /unlock を送ってください。',
  )
})

test('runUnlock: ok: false で message が空ならコードだけを出す', async () => {
  const result = { ok: false, error: { code: 'gateway/cancelled', message: '' } }
  assert.equal(
    await runUnlock(async () => result, 'en'),
    'Could not run /unlock (gateway/cancelled). Send /unlock from the input box instead.',
  )
})

test('runUnlock: value が undefined(コマンドが見つからない)なら Host 側の案内を出す', async () => {
  assert.equal(
    await runUnlock(async () => ({ ok: true, value: undefined }), 'ja'),
    '/unlock が見つかりません。cache-sentinel の Host 側が動いていない可能性があります。',
  )
})

test('runUnlock: 例外は失敗として文面にする', async () => {
  const execute = async () => {
    throw new Error('cannot get property "remote.commands" without inject')
  }
  assert.equal(
    await runUnlock(execute, 'zh-CN'),
    '无法执行 /unlock(cannot get property "remote.commands" without inject)。请在输入框中发送 /unlock。',
  )
})

test('runUnlock: 想定外の戻り値は失敗として扱う', async () => {
  const expected = 'Could not run /unlock (unexpected response). Send /unlock from the input box instead.'
  assert.equal(await runUnlock(async () => undefined, 'en'), expected)
  assert.equal(await runUnlock(async () => ({ value: {} }), 'en'), expected)
})
