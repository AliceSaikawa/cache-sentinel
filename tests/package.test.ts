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
  peerDependencies: Record<string, string>
  engines?: Record<string, string>
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

test('対応する DSH の版を peerDependencies で宣言している', () => {
  assert.deepEqual(manifest.peerDependencies, { '@deepseek-ai/dsh': '>=0.2.0-rc.2 <=0.2.1-rc.3' })
})

test('engines.dsh を宣言していない(あると DSH は peerDependencies を見ずに engines.dsh だけで判定する)', () => {
  assert.equal(manifest.engines?.dsh, undefined)
})

test('README 3 言語に package.json と同じ対応範囲が書かれている', () => {
  const range = manifest.peerDependencies['@deepseek-ai/dsh']
  assert.ok(range, '@deepseek-ai/dsh の peer が無い')
  const bounds = /^>=(\S+) <=(\S+)$/.exec(range)
  assert.ok(bounds, `範囲の形が想定外: ${range}`)
  const [, lower, upper] = bounds
  const headings: Record<string, string> = {
    'README.md': `**${lower} to ${upper}**`,
    'README.ja.md': `**${lower} 〜 ${upper}**`,
    'README.zh-CN.md': `**${lower} ～ ${upper}**`,
  }
  for (const [file, heading] of Object.entries(headings)) {
    const text = readFileSync(resolve(root, file), 'utf8')
    assert.ok(text.includes(`"@deepseek-ai/dsh": "${range}"`), `${file} に宣言の値 ${range} が無い`)
    assert.ok(text.includes(heading), `${file} に対応範囲 ${heading} が無い`)
  }
})
