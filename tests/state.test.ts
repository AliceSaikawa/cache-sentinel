import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  type State,
  STATE_RETENTION_MS,
  loadState,
  parseState,
  pruneState,
  saveState,
} from '../src/state.ts'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

/** テスト用の一時ディレクトリを作り、終了時に削除する。 */
async function tmpDir(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-state-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// --- parseState ---

test('STATE_RETENTION_MS は 7 日 (仕様 §7)', () => {
  assert.equal(STATE_RETENTION_MS, 7 * DAY)
})

test('undefined は baselineAt = now の新規 State', () => {
  assert.deepEqual(parseState(undefined, NOW), { version: 1, baselineAt: NOW, unarchivedAt: {} })
})

test('空文字・JSON 不正は新規 State', () => {
  for (const text of ['', '   ', '{', 'not json', '{"version":1,']) {
    assert.deepEqual(parseState(text, NOW), { version: 1, baselineAt: NOW, unarchivedAt: {} })
  }
})

test('JSON だがオブジェクト以外は新規 State', () => {
  for (const text of ['null', '1', '"x"', 'true', '[]', '[1,2]']) {
    assert.deepEqual(parseState(text, NOW), { version: 1, baselineAt: NOW, unarchivedAt: {} })
  }
})

test('version 不一致・欠落は新規 State', () => {
  assert.deepEqual(
    parseState('{"version":2,"baselineAt":100,"unarchivedAt":{}}', NOW),
    { version: 1, baselineAt: NOW, unarchivedAt: {} },
  )
  assert.deepEqual(
    parseState('{"baselineAt":100,"unarchivedAt":{}}', NOW),
    { version: 1, baselineAt: NOW, unarchivedAt: {} },
  )
})

test('baselineAt が非負有限数でなければ新規 State', () => {
  for (const value of ['-1', '"100"', 'null', 'true', '1e999', '{}']) {
    assert.deepEqual(
      parseState(`{"version":1,"baselineAt":${value},"unarchivedAt":{}}`, NOW),
      { version: 1, baselineAt: NOW, unarchivedAt: {} },
    )
  }
})

test('妥当な state をそのまま読む', () => {
  const text = '{"version":1,"baselineAt":100,"unarchivedAt":{"a":200,"b":300}}'
  assert.deepEqual(parseState(text, NOW), {
    version: 1,
    baselineAt: 100,
    unarchivedAt: { a: 200, b: 300 },
  })
})

test('baselineAt が 0 でも有効 (非負)', () => {
  assert.deepEqual(parseState('{"version":1,"baselineAt":0,"unarchivedAt":{}}', NOW), {
    version: 1,
    baselineAt: 0,
    unarchivedAt: {},
  })
})

test('unarchivedAt の不正エントリだけを捨てる (部分破損)', () => {
  const text = JSON.stringify({
    version: 1,
    baselineAt: 100,
    unarchivedAt: { good: 200, negative: -5, str: 'x', nul: null, zero: 0, extra: true },
  })
  assert.deepEqual(parseState(text, NOW), {
    version: 1,
    baselineAt: 100,
    unarchivedAt: { good: 200, zero: 0 },
  })
})

test('unarchivedAt 欠落・null・非オブジェクトは空として扱い baselineAt は保つ', () => {
  for (const text of [
    '{"version":1,"baselineAt":100}',
    '{"version":1,"baselineAt":100,"unarchivedAt":null}',
    '{"version":1,"baselineAt":100,"unarchivedAt":7}',
    '{"version":1,"baselineAt":100,"unarchivedAt":"x"}',
  ]) {
    assert.deepEqual(parseState(text, NOW), { version: 1, baselineAt: 100, unarchivedAt: {} })
  }
})

// --- pruneState ---

test('pruneState は now - 保持期間より古い記録を削除し境界は残す', () => {
  const cutoff = NOW - STATE_RETENTION_MS
  const state: State = {
    version: 1,
    baselineAt: 1,
    unarchivedAt: {
      older: cutoff - 1,
      boundary: cutoff,
      newer: cutoff + 1,
    },
  }
  assert.deepEqual(pruneState(state, NOW), {
    version: 1,
    baselineAt: 1,
    unarchivedAt: { boundary: cutoff, newer: cutoff + 1 },
  })
})

test('pruneState は knownIds にない id を削除する', () => {
  const state: State = {
    version: 1,
    baselineAt: 1,
    unarchivedAt: { alive: NOW, gone: NOW },
  }
  assert.deepEqual(pruneState(state, NOW, new Set(['alive'])), {
    version: 1,
    baselineAt: 1,
    unarchivedAt: { alive: NOW },
  })
})

test('pruneState は古さと knownIds の両方で絞る', () => {
  const state: State = {
    version: 1,
    baselineAt: 1,
    unarchivedAt: { old: NOW - STATE_RETENTION_MS - 1, gone: NOW, alive: NOW },
  }
  assert.deepEqual(pruneState(state, NOW, new Set(['alive', 'old'])), {
    version: 1,
    baselineAt: 1,
    unarchivedAt: { alive: NOW },
  })
})

test('pruneState は新しいオブジェクトを返し入力を変更しない', () => {
  const state: State = {
    version: 1,
    baselineAt: 1,
    unarchivedAt: { old: NOW - STATE_RETENTION_MS - 1, keep: NOW },
  }
  const snapshot = structuredClone(state)

  const result = pruneState(state, NOW)

  assert.notEqual(result, state)
  assert.notEqual(result.unarchivedAt, state.unarchivedAt)
  assert.deepEqual(state, snapshot)
  assert.deepEqual(result.unarchivedAt, { keep: NOW })
})

// --- loadState ---

test('loadState はファイル欠落で新規 State を返しファイルを作らない', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')

  assert.deepEqual(await loadState(path, NOW), { version: 1, baselineAt: NOW, unarchivedAt: {} })
  assert.equal(await exists(path), false)
})

test('loadState は破損 JSON で新規 State (A7)', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')
  await writeFile(path, 'not json at all', 'utf8')

  assert.deepEqual(await loadState(path, NOW), { version: 1, baselineAt: NOW, unarchivedAt: {} })
})

test('loadState は ENOENT 以外の読み取りエラーでも新規 State', async (t) => {
  const dir = await tmpDir(t)
  // ディレクトリを読むと EISDIR になる。
  assert.deepEqual(await loadState(dir, NOW), { version: 1, baselineAt: NOW, unarchivedAt: {} })
})

test('loadState は保存済みの内容を復元する (往復)', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')
  const state: State = { version: 1, baselineAt: 100, unarchivedAt: { a: 200, b: 300 } }

  await saveState(path, state)

  assert.deepEqual(await loadState(path, NOW), state)
})

// --- saveState ---

test('saveState は親ディレクトリを作り整形 JSON と末尾改行で書く', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'nested', 'deep', 'state.json')
  const state: State = { version: 1, baselineAt: 100, unarchivedAt: { a: 200 } }

  await saveState(path, state)

  const text = await readFile(path, 'utf8')
  assert.equal(text, `${JSON.stringify(state, null, 2)}\n`)
  assert.ok(text.endsWith('\n'))
})

test('saveState は一時ファイルを残さない (atomic)', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')
  const state: State = { version: 1, baselineAt: 100, unarchivedAt: {} }

  await saveState(path, state)

  assert.deepEqual(await readdir(dir), ['state.json'])
})

test('saveState は既存ファイルを上書きし一時ファイルを残さない', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')

  await saveState(path, { version: 1, baselineAt: 1, unarchivedAt: { a: 1 } })
  await saveState(path, { version: 1, baselineAt: 2, unarchivedAt: { b: 2 } })

  assert.deepEqual(await loadState(path, NOW), { version: 1, baselineAt: 2, unarchivedAt: { b: 2 } })
  assert.deepEqual(await readdir(dir), ['state.json'])
})

test('saveState → pruneState → saveState → loadState の一連が動く', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')

  await saveState(path, {
    version: 1,
    baselineAt: 50,
    unarchivedAt: { stale: NOW - STATE_RETENTION_MS - 1, fresh: NOW },
  })
  const loaded = await loadState(path, NOW)
  const pruned = pruneState(loaded, NOW)
  await saveState(path, pruned)

  assert.deepEqual(await loadState(path, NOW), {
    version: 1,
    baselineAt: 50,
    unarchivedAt: { fresh: NOW },
  })
})

test('saveState は書き込み前に親ディレクトリを確実に用意する', async (t) => {
  const dir = await tmpDir(t)
  const nested = join(dir, 'a', 'b')
  await mkdir(nested, { recursive: true })
  const path = join(nested, 'state.json')

  await saveState(path, { version: 1, baselineAt: 1, unarchivedAt: {} })
  assert.equal(await exists(path), true)
})
