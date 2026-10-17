/**
 * `github:AliceSaikawa/cache-sentinel` でのインストール(issue #14)。
 * git 経由のインストールはリポジトリの中身をそのまま使い、ビルドしない。
 * そのため DSH が読むファイルはすべて git で管理されている必要がある。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  main: string
  icon: string
  files: string[]
  exports: Record<string, string | { default: string }>
  dsh: { bundle: { patch: string } }
}

/** `files` に挙げたもののうち git で管理されているファイル(リポジトリ直下からの相対パス)。 */
function trackedPackageFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...manifest.files], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(Boolean).sort()
}

const strip = (path: string) => path.replace(/^\.\//, '')

test('package.json の files に挙げたファイルがすべて git で管理されている', () => {
  assert.deepEqual(trackedPackageFiles(), ['cordis.patch.yml', 'icon.svg', 'lib/client.js', 'lib/index.js'])
})

test('main・exports・icon・バンドルの patch が指すファイルは git で管理されている', () => {
  const tracked = new Set([...trackedPackageFiles(), 'package.json'])
  const referenced = [
    manifest.main,
    ...Object.values(manifest.exports).map((entry) => (typeof entry === 'string' ? entry : entry.default)),
    manifest.icon,
    manifest.dsh.bundle.patch,
  ].map(strip)
  assert.deepEqual(referenced.filter((path) => !tracked.has(path)), [])
})

test('icon は DSH が読める形式・大きさ(SVG / PNG / JPEG / WebP、256 KiB 以下)', () => {
  assert.equal(manifest.icon, './icon.svg')
  assert.ok(statSync(resolve(root, manifest.icon)).size <= 256 * 1024)
})
