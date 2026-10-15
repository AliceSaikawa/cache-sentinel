import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { decodeSegment, scanLogMtimes } from '../src/activity.ts'

const BASE_SECONDS = 1_700_000_000

/** テスト用の一時ディレクトリを作り、終了時に削除する。 */
async function tmpDir(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-activity-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

/** ファイルを内容つきで作り、mtime を固定する (mtimeMs = seconds * 1000)。 */
async function touch(path: string, seconds: number, content = 'x'): Promise<void> {
  await writeFile(path, content, 'utf8')
  await utimes(path, seconds, seconds)
}

/** `<root>/<project>/<session>/<file>` とその親を作る。 */
async function makeSession(
  root: string,
  project: string,
  session: string,
): Promise<string> {
  const sessionPath = join(root, project, session)
  await mkdir(sessionPath, { recursive: true })
  return sessionPath
}

// --- decodeSegment ---

test('decodeSegment は UUID 形式の id をそのまま返す (恒等)', () => {
  const id = '0191e2f3-4a5b-7c8d-9e0f-123456789abc'
  assert.equal(decodeSegment(id), id)
})

test('decodeSegment は ~ + 大文字16進4桁 をコードユニットに戻す', () => {
  assert.equal(decodeSegment('a~002Eb'), 'a.b')
  assert.equal(decodeSegment('~002E'), '.')
  assert.equal(decodeSegment('~002E~002E'), '..')
  assert.equal(decodeSegment('~007E'), '~')
  assert.equal(decodeSegment('~002F'), '/')
  assert.equal(decodeSegment('~005C'), '\\')
  assert.equal(decodeSegment('~0000'), '\u0000')
  assert.equal(decodeSegment('~ABCD'), String.fromCharCode(0xabcd))
})

test('decodeSegment は複数のエスケープを順に戻す', () => {
  assert.equal(decodeSegment('a~002Eb~0041c'), 'a.bAc')
  assert.equal(decodeSegment('~0020~0020'), '  ')
})

test('decodeSegment は安全な文字をそのまま返す', () => {
  assert.equal(decodeSegment('session.v4.jsonl.zstd'), 'session.v4.jsonl.zstd')
  assert.equal(decodeSegment('a-b_c.d'), 'a-b_c.d')
})

test('decodeSegment はエスケープに見えない ~ をそのまま残す', () => {
  // 小文字16進はエスケープではない (encodeSegment は大文字で出す)
  assert.equal(decodeSegment('a~002eb'), 'a~002eb')
  // 桁数が足りない
  assert.equal(decodeSegment('~123'), '~123')
  // 5 桁目は 4 桁エスケープの後ろの通常文字 (encodeSegment の往復と一致)
  assert.equal(decodeSegment('~12345'), `${String.fromCharCode(0x1234)}5`)
  // 16進でない文字
  assert.equal(decodeSegment('~00G0'), '~00G0')
  // 4 桁だが前後に余分な ~ がある場合は該当分のみ戻す
  assert.equal(decodeSegment('~~0041'), '~A')
  assert.equal(decodeSegment('~'), '~')
})

// --- scanLogMtimes ---

test('存在しない root は空の Map', async (t) => {
  const dir = await tmpDir(t)
  const result = await scanLogMtimes(join(dir, 'does-not-exist'))
  assert.deepEqual(result, new Map())
})

test('root がファイルの場合は空の Map (readdir 失敗を伝播させない)', async (t) => {
  const dir = await tmpDir(t)
  const root = join(dir, 'sessions')
  await writeFile(root, 'not a directory', 'utf8')

  assert.deepEqual(await scanLogMtimes(root), new Map())
})

test('.jsonl.zstd と .jsonl の両方を対象にする', async (t) => {
  const root = await tmpDir(t)
  const a = await makeSession(root, '--proj--', 'id-a')
  const b = await makeSession(root, '--proj--', 'id-b')
  await touch(join(a, 'session.v4.jsonl.zstd'), BASE_SECONDS + 10)
  await touch(join(b, 'session.v4.jsonl'), BASE_SECONDS + 20)

  const result = await scanLogMtimes(root)

  assert.deepEqual(result, new Map([
    ['id-a', (BASE_SECONDS + 10) * 1000],
    ['id-b', (BASE_SECONDS + 20) * 1000],
  ]))
})

test('複数世代があるディレクトリは mtimeMs の最大値を採る', async (t) => {
  const root = await tmpDir(t)
  const a = await makeSession(root, '--proj--', 'id-a')
  await touch(join(a, 'session.v3.jsonl'), BASE_SECONDS + 5)
  await touch(join(a, 'session.v4.jsonl'), BASE_SECONDS + 30)
  await touch(join(a, 'session.v4.jsonl.zstd'), BASE_SECONDS + 15)

  const result = await scanLogMtimes(root)

  assert.deepEqual(result, new Map([['id-a', (BASE_SECONDS + 30) * 1000]]))
})

test('session.lock や *.tmp やその他のファイルは無視する', async (t) => {
  const root = await tmpDir(t)
  const a = await makeSession(root, '--proj--', 'id-a')
  await touch(join(a, 'session.lock'), BASE_SECONDS + 99)
  await touch(join(a, 'session.v4.jsonl.tmp'), BASE_SECONDS + 99)
  await touch(join(a, 'notes.txt'), BASE_SECONDS + 99)
  await touch(join(a, 'session.jsonl'), BASE_SECONDS + 99)
  await touch(join(a, 'session.v4.jsonl'), BASE_SECONDS + 1)

  const result = await scanLogMtimes(root)

  assert.deepEqual(result, new Map([['id-a', (BASE_SECONDS + 1) * 1000]]))
})

test('lock だけのセッションディレクトリは結果に現れない', async (t) => {
  const root = await tmpDir(t)
  const locked = await makeSession(root, '--proj--', 'id-locked')
  await touch(join(locked, 'session.lock'), BASE_SECONDS + 50)

  const result = await scanLogMtimes(root)

  assert.equal(result.has('id-locked'), false)
  assert.deepEqual(result, new Map())
})

test('同じ id が複数の project にあれば最大値を採る', async (t) => {
  const root = await tmpDir(t)
  const first = await makeSession(root, '--proj-one--', 'id-shared')
  const second = await makeSession(root, '--proj-two--', 'id-shared')
  await touch(join(first, 'session.v4.jsonl'), BASE_SECONDS + 7)
  await touch(join(second, 'session.v4.jsonl'), BASE_SECONDS + 42)

  const result = await scanLogMtimes(root)

  assert.deepEqual(result, new Map([['id-shared', (BASE_SECONDS + 42) * 1000]]))
})

test('ディレクトリ名を decodeSegment した値をキーにする', async (t) => {
  const root = await tmpDir(t)
  const a = await makeSession(root, '--proj--', 'a~002Eb')
  await touch(join(a, 'session.v4.jsonl'), BASE_SECONDS + 3)

  const result = await scanLogMtimes(root)

  assert.deepEqual(result, new Map([['a.b', (BASE_SECONDS + 3) * 1000]]))
})

test('ディレクトリ以外のエントリは無視する', async (t) => {
  const root = await tmpDir(t)
  // projectDir 直下の普通のファイル
  await touch(join(root, 'loose.txt'), BASE_SECONDS + 99)
  // sessionsRoot 直下の普通のファイル
  const project = join(root, '--proj--')
  await mkdir(project, { recursive: true })
  await touch(join(project, 'session.v4.jsonl'), BASE_SECONDS + 99)
  // 実体はディレクトリだが session ディレクトリ位置にある普通のファイル
  const a = await makeSession(root, '--proj--', 'id-a')
  await touch(join(a, 'session.v4.jsonl'), BASE_SECONDS + 8)

  const result = await scanLogMtimes(root)

  assert.deepEqual(result, new Map([['id-a', (BASE_SECONDS + 8) * 1000]]))
})

test('空の root は空の Map', async (t) => {
  const root = await tmpDir(t)
  assert.deepEqual(await scanLogMtimes(root), new Map())
})

test('projectDir はあるがログが無い場合は現れない', async (t) => {
  const root = await tmpDir(t)
  await makeSession(root, '--proj--', 'id-empty')

  assert.deepEqual(await scanLogMtimes(root), new Map())
})
