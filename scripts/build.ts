/**
 * lib/ にプラグインの 2 つの半分を出力する。
 * - lib/index.js: Host 半分(Node 用 ESM)。
 * - lib/client.js: 公式 Web UI のクライアント半分。CJS 本体をモジュールローダーの包みに入れる
 *   (dsh-webui-m3e の scripts/build-plugin.ts と同じ形)。React と DSH のパッケージはシェルが提供する。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { name: packageId } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { name: string }

const hostOut = resolve(root, 'lib/index.js')
await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: hostOut,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  legalComments: 'none',
  logLevel: 'warning',
})
if (!/\bexport\s*\{[^}]*\bapply\b/.test(await readFile(hostOut, 'utf8'))) {
  throw new Error('lib/index.js does not export apply')
}

const clientOut = resolve(root, 'lib/client.js')
await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile: clientOut,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  legalComments: 'none',
  logLevel: 'warning',
})
const body = await readFile(clientOut, 'utf8')
if (!/\bapply\b/.test(body) || !/\binject\b/.test(body)) throw new Error('lib/client.js does not expose apply/inject')
if (/node:/.test(body)) throw new Error('lib/client.js must not import node: modules')
await writeFile(
  clientOut,
  `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(packageId)},\n\tfactory: (require) => {\n` +
    `\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n` +
    body +
    `\n\t\treturn module.exports;\n\t}\n});\n`,
)
console.log('built lib/index.js and lib/client.js')
