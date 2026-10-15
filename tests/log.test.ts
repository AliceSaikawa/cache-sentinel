import assert from 'node:assert/strict'
import test from 'node:test'
import { createLogger, LOG_PREFIX } from '../src/log.ts'

function recorder() {
  const calls: string[] = []
  return {
    calls,
    base: {
      debug: (m: string) => calls.push(`base.debug:${m}`),
      info: (m: string) => calls.push(`base.info:${m}`),
      warn: (m: string) => calls.push(`base.warn:${m}`),
    },
    sink: {
      log: (m: string) => calls.push(`sink.log:${m}`),
      warn: (m: string) => calls.push(`sink.warn:${m}`),
    },
  }
}

test('info は ctx.logger と console.log の両方に接頭辞付きで出る', () => {
  const r = recorder()
  createLogger(r.base, r.sink).info('開始')
  assert.deepEqual(r.calls, ['base.info:開始', `sink.log:${LOG_PREFIX} 開始`])
})

test('warn は ctx.logger と console.warn の両方に出る', () => {
  const r = recorder()
  createLogger(r.base, r.sink).warn('失敗')
  assert.deepEqual(r.calls, ['base.warn:失敗', `sink.warn:${LOG_PREFIX} 失敗`])
})

test('debug は ctx.logger だけに出て console には出ない', () => {
  const r = recorder()
  createLogger(r.base, r.sink).debug('見送り')
  assert.deepEqual(r.calls, ['base.debug:見送り'])
})
