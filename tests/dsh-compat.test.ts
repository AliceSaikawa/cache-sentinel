import assert from 'node:assert/strict'
import test from 'node:test'
import { diffFileLists, isIgnoredPath, PACKAGES } from '../scripts/dsh-compat.ts'

test('diffFileLists は同じファイル一覧を same とする', () => {
  const files = { 'lib/index.js': 'a', 'lib/types/index.d.ts': 'b' }
  assert.deepEqual(diffFileLists(files, { ...files }), { verdict: 'same', added: [], removed: [], changed: [] })
})

test('diffFileLists は追加・削除・変更をパスつきで検出する', () => {
  const base = { 'a.js': '1', 'b.js': '2', 'c/sub.js': '3' }
  const compare = { 'a.js': '1x', 'c/sub.js': '3', 'd.js': '4' }
  assert.deepEqual(diffFileLists(base, compare), {
    verdict: 'diff',
    added: ['d.js'],
    removed: ['b.js'],
    changed: ['a.js'],
  })
})

test('diffFileLists は package.json / CHANGELOG / README の違いを無視する', () => {
  const base = { 'package.json': 'v1', 'CHANGELOG.md': 'x', 'README.ja.md': 'y', 'lib/index.js': 'a' }
  const compare = { 'package.json': 'v2', 'CHANGELOG.md': 'z', 'README.ja.md': 'w', 'lib/index.js': 'a' }
  assert.deepEqual(diffFileLists(base, compare), { verdict: 'same', added: [], removed: [], changed: [] })
})

test('isIgnoredPath はパッケージ直下のメタデータだけを無視する', () => {
  assert.equal(isIgnoredPath('package.json'), true)
  assert.equal(isIgnoredPath('CHANGELOG.md'), true)
  assert.equal(isIgnoredPath('README.md'), true)
  assert.equal(isIgnoredPath('lib/package.json'), false)
  assert.equal(isIgnoredPath('lib/index.js'), false)
})

test('PACKAGES は @deepseek-ai の対象パッケージを重複なく並べる', () => {
  assert.equal(PACKAGES.length, 16)
  assert.equal(new Set(PACKAGES).size, PACKAGES.length)
  for (const pkg of PACKAGES) assert.match(pkg, /^@deepseek-ai\/dsh-/)
})
