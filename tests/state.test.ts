import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import test from 'node:test'

import {
  type State,
  STATE_RETENTION_MS,
  emptyState,
  loadState,
  parseState,
  saveState,
  tempPathFor,
} from '../src/state.ts'

const DAY = 24 * 60 * 60 * 1000
const EMPTY: State = { version: 2, unarchivedAt: {} }

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

// --- emptyState ---

test('STATE_RETENTION_MS は 7 日 (archive-spec §7)', () => {
  assert.equal(STATE_RETENTION_MS, 7 * DAY)
})

test('emptyState は version 2 で mode と baselineAt を持たない', () => {
  const state = emptyState()
  assert.deepEqual(state, EMPTY)
  assert.deepEqual(Object.keys(state), ['version', 'unarchivedAt'])
})

// --- parseState: 全体破損 ---

test('undefined は空の状態 (§C 破損時)', () => {
  assert.deepEqual(parseState(undefined), EMPTY)
})

test('空文字・JSON 不正は空の状態', () => {
  for (const text of ['', '   ', '{', 'not json', '{"version":2,']) {
    assert.deepEqual(parseState(text), EMPTY)
  }
})

test('JSON だがオブジェクト以外は空の状態', () => {
  for (const text of ['null', '1', '"x"', 'true', '[]', '[1,2]']) {
    assert.deepEqual(parseState(text), EMPTY)
  }
})

test('version が 1 でも 2 でもなければ空の状態', () => {
  for (const text of [
    '{"unarchivedAt":{}}',
    '{"version":0,"baselineAt":100,"unarchivedAt":{}}',
    '{"version":3,"mode":"both","baselineAt":100,"unarchivedAt":{}}',
    '{"version":"2","baselineAt":100,"unarchivedAt":{}}',
    '{"version":null,"baselineAt":100,"unarchivedAt":{}}',
  ]) {
    assert.deepEqual(parseState(text), EMPTY)
  }
})

// --- parseState: version 1 ---

test('v1 を読むと version 2 の state になる', () => {
  const text = '{"version":1,"baselineAt":100,"unarchivedAt":{"a":200,"b":300}}'
  assert.deepEqual(parseState(text), {
    version: 2,
    baselineAt: 100,
    unarchivedAt: { a: 200, b: 300 },
  })
})

test('v1 は baselineAt が 0 でも有効 (非負)', () => {
  assert.deepEqual(parseState('{"version":1,"baselineAt":0,"unarchivedAt":{}}'), {
    version: 2,
    baselineAt: 0,
    unarchivedAt: {},
  })
})

test('v1 は baselineAt が不正なら全体を破損として空の状態 (v1 では必須)', () => {
  for (const value of ['-1', '"100"', 'null', 'true', '1e999', '{}']) {
    assert.deepEqual(parseState(`{"version":1,"baselineAt":${value},"unarchivedAt":{"a":200}}`), EMPTY)
  }
  assert.deepEqual(parseState('{"version":1,"unarchivedAt":{"a":200}}'), EMPTY)
})

// --- parseState: version 2 ---

test('v2 の全項目を読む', () => {
  const text = '{"version":2,"mode":"both","baselineAt":1792062384184,"unarchivedAt":{"s":1792064310709}}'
  assert.deepEqual(parseState(text), {
    version: 2,
    mode: 'both',
    baselineAt: 1792062384184,
    unarchivedAt: { s: 1792064310709 },
  })
})

test('v2 の mode は 4 種類すべて読める', () => {
  for (const mode of ['block', 'archive', 'both', 'off']) {
    assert.deepEqual(parseState(`{"version":2,"mode":"${mode}","unarchivedAt":{}}`), {
      version: 2,
      mode,
      unarchivedAt: {},
    })
  }
})

test('v2 は mode と baselineAt を省略できる', () => {
  assert.deepEqual(parseState('{"version":2,"unarchivedAt":{}}'), EMPTY)
  assert.deepEqual(parseState('{"version":2,"mode":"block","unarchivedAt":{}}'), {
    version: 2,
    mode: 'block',
    unarchivedAt: {},
  })
  assert.deepEqual(parseState('{"version":2,"baselineAt":5,"unarchivedAt":{}}'), {
    version: 2,
    baselineAt: 5,
    unarchivedAt: {},
  })
})

test('v2 の不正な mode は捨てる (他の項目は残す)', () => {
  for (const value of ['"nope"', '"BLOCK"', '1', 'null', 'true', '["both"]', '{}']) {
    assert.deepEqual(parseState(`{"version":2,"mode":${value},"baselineAt":100,"unarchivedAt":{"a":1}}`), {
      version: 2,
      baselineAt: 100,
      unarchivedAt: { a: 1 },
    })
  }
})

test('v2 の不正な baselineAt は捨てる (他の項目は残す)', () => {
  for (const value of ['-1', '"100"', 'null', 'true', '1e999', '{}']) {
    assert.deepEqual(parseState(`{"version":2,"mode":"off","baselineAt":${value},"unarchivedAt":{}}`), {
      version: 2,
      mode: 'off',
      unarchivedAt: {},
    })
  }
})

test('v2 は mode と baselineAt の両方が不正ならキーごと消える', () => {
  const state = parseState('{"version":2,"mode":"nope","baselineAt":-1,"unarchivedAt":{}}')
  assert.deepEqual(state, EMPTY)
  assert.deepEqual(Object.keys(state), ['version', 'unarchivedAt'])
})

test('v2 の baselineAt は 0 でも有効 (非負)', () => {
  assert.deepEqual(parseState('{"version":2,"baselineAt":0,"unarchivedAt":{}}'), {
    version: 2,
    baselineAt: 0,
    unarchivedAt: {},
  })
})

// --- parseState: unarchivedAt の部分破損 ---

test('unarchivedAt の不正エントリだけを捨てる (部分破損)', () => {
  const text = JSON.stringify({
    version: 2,
    mode: 'archive',
    baselineAt: 100,
    unarchivedAt: { good: 200, negative: -5, str: 'x', nul: null, zero: 0, extra: true },
  })
  assert.deepEqual(parseState(text), {
    version: 2,
    mode: 'archive',
    baselineAt: 100,
    unarchivedAt: { good: 200, zero: 0 },
  })
})

test('v1 の unarchivedAt も不正エントリだけを捨てる', () => {
  const text = JSON.stringify({
    version: 1,
    baselineAt: 100,
    unarchivedAt: { good: 200, bad: 'x' },
  })
  assert.deepEqual(parseState(text), { version: 2, baselineAt: 100, unarchivedAt: { good: 200 } })
})

test('unarchivedAt 欠落・null・非オブジェクトは空として扱い他は保つ', () => {
  for (const text of [
    '{"version":2,"mode":"both","baselineAt":100}',
    '{"version":2,"mode":"both","baselineAt":100,"unarchivedAt":null}',
    '{"version":2,"mode":"both","baselineAt":100,"unarchivedAt":7}',
    '{"version":2,"mode":"both","baselineAt":100,"unarchivedAt":"x"}',
  ]) {
    assert.deepEqual(parseState(text), {
      version: 2,
      mode: 'both',
      baselineAt: 100,
      unarchivedAt: {},
    })
  }
})

// --- loadState ---

test('loadState はファイル欠落で空の状態を返しファイルを作らない', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')

  assert.deepEqual(await loadState(path), EMPTY)
  assert.equal(await exists(path), false)
  assert.deepEqual(await readdir(dir), [])
})

test('loadState は破損 JSON で空の状態 (A7)', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')
  await writeFile(path, 'not json at all', 'utf8')

  assert.deepEqual(await loadState(path), EMPTY)
})

test('loadState は ENOENT 以外の読み取りエラーでも空の状態', async (t) => {
  const dir = await tmpDir(t)
  // ディレクトリを読むと EISDIR になる。
  assert.deepEqual(await loadState(dir), EMPTY)
})

test('loadState は v1 のファイルを version 2 として読む', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')
  await writeFile(path, '{"version":1,"baselineAt":100,"unarchivedAt":{"a":200}}', 'utf8')

  assert.deepEqual(await loadState(path), { version: 2, baselineAt: 100, unarchivedAt: { a: 200 } })
})

// --- saveState ---

test('saveState は親ディレクトリを作り整形 JSON と末尾改行で書く', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'nested', 'deep', 'state.json')
  const state: State = { version: 2, mode: 'both', baselineAt: 100, unarchivedAt: { a: 200 } }

  await saveState(path, state)

  const text = await readFile(path, 'utf8')
  assert.equal(text, `${JSON.stringify(state, null, 2)}\n`)
  assert.ok(text.endsWith('\n'))
})

test('saveState は一時ファイルを残さない (atomic)', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')

  await saveState(path, EMPTY)

  assert.deepEqual(await readdir(dir), ['state.json'])
})

test('saveState → loadState の往復で内容が保たれる', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')
  const state: State = {
    version: 2,
    mode: 'archive',
    baselineAt: 100,
    unarchivedAt: { a: 200, b: 300 },
  }

  await saveState(path, state)

  assert.deepEqual(await loadState(path), state)
})

test('saveState → loadState の往復で省略したキーは省略のままになる', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')

  await saveState(path, { version: 2, unarchivedAt: { a: 200 } })
  const loaded = await loadState(path)

  assert.deepEqual(loaded, { version: 2, unarchivedAt: { a: 200 } })
  assert.deepEqual(Object.keys(loaded), ['version', 'unarchivedAt'])
})

test('saveState は既存ファイルを上書きし一時ファイルを残さない', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')

  await saveState(path, { version: 2, baselineAt: 1, unarchivedAt: { a: 1 } })
  await saveState(path, { version: 2, mode: 'off', unarchivedAt: { b: 2 } })

  assert.deepEqual(await loadState(path), { version: 2, mode: 'off', unarchivedAt: { b: 2 } })
  assert.deepEqual(await readdir(dir), ['state.json'])
})

test('saveState は書き込み前に親ディレクトリを確実に用意する', async (t) => {
  const dir = await tmpDir(t)
  const nested = join(dir, 'a', 'b')
  await mkdir(nested, { recursive: true })
  const path = join(nested, 'state.json')

  await saveState(path, EMPTY)
  assert.equal(await exists(path), true)
})

test('saveState は注入した path 実装でも同じディレクトリに書き rename で置き換える', async (t) => {
  const dir = await tmpDir(t)
  const path = join(dir, 'state.json')
  const state: State = { version: 2, mode: 'off', unarchivedAt: {} }

  await saveState(path, state, posix)

  assert.deepEqual(await readdir(dir), ['state.json'])
  assert.deepEqual(await loadState(path), state)
})

// --- tempPathFor (Issue #6: Windows 形式のパスでも保存できること) ---

test('tempPathFor は win32 の保存先と同じディレクトリに一時ファイルを作る (Issue #6)', () => {
  const target = 'C:\\Users\\u\\.dsh\\cache-sentinel\\state.json'
  const tmp = tempPathFor(target, '1234.5.ab', win32)

  assert.equal(tmp, 'C:\\Users\\u\\.dsh\\cache-sentinel\\state.json.1234.5.ab.tmp')
  assert.equal(win32.dirname(tmp), 'C:\\Users\\u\\.dsh\\cache-sentinel')

  const name = win32.basename(tmp)
  assert.ok(name.startsWith('state.json.'))
  assert.ok(name.endsWith('.tmp'))
  // 修正前は target 全体がファイル名扱いになり、名前にドライブの `:` が残った。
  assert.ok(!name.includes(':'))
})

test('tempPathFor は posix の保存先と同じディレクトリに一時ファイルを作る', () => {
  const target = '/home/u/.dsh/cache-sentinel/state.json'
  const tmp = tempPathFor(target, '1234.5.ab', posix)

  assert.equal(tmp, '/home/u/.dsh/cache-sentinel/state.json.1234.5.ab.tmp')
  assert.equal(posix.dirname(tmp), '/home/u/.dsh/cache-sentinel')

  const name = posix.basename(tmp)
  assert.ok(name.startsWith('state.json.'))
  assert.ok(name.endsWith('.tmp'))
})

test('tempPathFor は親ディレクトリを持たない保存先でも現在のディレクトリに作る', () => {
  assert.equal(tempPathFor('state.json', 'x', posix), 'state.json.x.tmp')
  assert.equal(tempPathFor('state.json', 'x', win32), 'state.json.x.tmp')
})
