import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchStatus } from '../src/client/fetch-status.ts'

const BODY = { mode: 'block', gate: true, state: 'stale', idleMinutes: 75, thresholdMinutes: 60, unlockExpiresAt: null, dryRun: false }

test('fetchStatus は base からの相対 URL を同一オリジンの Cookie 付き・キャッシュなしで取得する', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(BODY), { status: 200 })
  }) as unknown as typeof fetch
  const status = await fetchStatus('session-a b', 'http://h/app/', fake)
  assert.deepEqual(status, { gate: true, state: 'stale', idleMinutes: 75, unlockExpiresAt: null, dryRun: false })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'http://h/app/api/cache-sentinel.status?sessionId=session-a+b')
  assert.deepEqual(calls[0]?.init, { credentials: 'same-origin', cache: 'no-store' })
})

test('fetchStatus は 404 などの失敗応答で undefined(プラグインが無い DSH では何も出さない)', async () => {
  const fake = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
  assert.equal(await fetchStatus('s', 'http://h/', fake), undefined)
})

test('fetchStatus は通信の例外と不正な JSON で undefined', async () => {
  const throws = (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
  assert.equal(await fetchStatus('s', 'http://h/', throws), undefined)
  const bad = (async () => new Response('{not json', { status: 200 })) as unknown as typeof fetch
  assert.equal(await fetchStatus('s', 'http://h/', bad), undefined)
  const wrongShape = (async () => new Response(JSON.stringify({ gate: 'yes' }), { status: 200 })) as unknown as typeof fetch
  assert.equal(await fetchStatus('s', 'http://h/', wrongShape), undefined)
})
