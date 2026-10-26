/**
 * DSH の版ごとに、cache-sentinel が使うパッケージの中身が変わったかを調べる。
 *
 * 目的:
 *   新しい DSH の版が出たとき、cache-sentinel が使っている @deepseek-ai/* の各パッケージが
 *   確認済みの版から変わったかを機械的に調べる。変わっていなければ従来の動作のまま(互換の見込み)と
 *   判断でき、変わっていればその差分を人が読む。
 *
 * 使い方:
 *   node scripts/dsh-compat.ts <作業ディレクトリ> <基準の版> <比べる版...>
 *   例: node scripts/dsh-compat.ts /var/tmp/dsh-compat 0.2.1-rc.1 0.2.1-rc.2
 *
 * 判定(1 行に <版>\t<パッケージ>\t<判定>):
 *   same    … package.json / CHANGELOG / README 以外のファイルが基準の版と一致(互換の見込み)
 *   diff    … 追加・削除・変更されたファイルがある(人が差分を読む)
 *   missing … npm からの取得に失敗した
 *
 * 各版の各パッケージは <作業ディレクトリ>/<版>/<パッケージ>/ に展開し、次回は展開済みなら取得し直さない。
 * 終了コードは、取得に失敗した組み合わせがあれば 1、それ以外(diff を含む)は 0。
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const SCOPE = '@deepseek-ai/'
/** diff のときに表示する変わったパスの上限。 */
const MAX_DETAILS = 10

/**
 * cache-sentinel が使う DSH のパッケージ。ここが変われば互換性を確認し直す。
 * docs/spike.md の互換調査で比べた対象に、その後に依存したもの(#9 の dsh-app-boot・dsh。spike.md Z1・Z3)と、
 * spike.md の各節が根拠に挙げているもの(0.2.1-rc.3 の調査で追加)を足したもの。
 */
export const PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-workspace',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
  // #9: ProfileContext の型とプロファイル名の検証(dsh-app-boot)、profileContext の provide(dsh)。
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh',
  // pre-step の prepend リスナー(spike.md「根拠(rc.1)」1)。
  '@deepseek-ai/dsh-session-reference',
  // 対応版の評価とインストール時の検査(#31。spike.md K2)。
  '@deepseek-ai/dsh-plugin-manager',
  // クライアントの remote.commands と、入力欄からのコマンド実行(#26・#36。spike.md「クライアント側 remote.commands の inject」・Y2)。
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-typert-protocol',
  // 入力の出どころ source.kind と form(#7・#29。spike.md P2・N1)。
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-schedule',
  '@deepseek-ai/dsh-goal-round-driver',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-user-questions',
  '@deepseek-ai/dsh-experimental-agent-team',
  // サブエージェントの子セッション(#13。spike.md R1〜R4)。
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-subagent-fork-in-process',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
  // バナーの描画と配色(#46。spike.md「入力欄の上のバナーの見た目」)。
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-theme',
]

/** パッケージ 1 つ分のファイル一覧。相対パス → 内容のハッシュ。 */
export type FileList = Record<string, string>

/** 2 つのファイル一覧の比較結果。 */
export type FileListDiff = {
  verdict: 'same' | 'diff'
  added: string[]
  removed: string[]
  changed: string[]
}

/**
 * 比較から外すファイルか。版ごとに必ず変わるメタデータで、互換性の判断には使わない。
 * パッケージ直下のものだけを対象にする(入れ子の package.json などは比較する)。
 */
export function isIgnoredPath(path: string): boolean {
  if (path.includes('/')) return false
  return path === 'package.json' || path === 'CHANGELOG.md' || path.startsWith('README')
}

/**
 * 2 つのファイル一覧を、無視するパスを除いて比べる。
 * 追加・削除・変更がどれも無ければ same、1 つでもあれば diff を返す。
 */
export function diffFileLists(base: FileList, compare: FileList): FileListDiff {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  const remaining = new Set(Object.keys(compare).filter((path) => !isIgnoredPath(path)))

  for (const path of Object.keys(base).filter((path) => !isIgnoredPath(path)).sort()) {
    if (!remaining.has(path)) {
      removed.push(path)
    } else if (base[path] !== compare[path]) {
      changed.push(path)
    }
    remaining.delete(path)
  }
  added.push(...[...remaining].sort())

  const verdict = added.length > 0 || removed.length > 0 || changed.length > 0 ? 'diff' : 'same'
  return { verdict, added, removed, changed }
}

/** 展開先。スコープは落として <作業ディレクトリ>/<版>/dsh-agent/ のようにする。 */
function packageDir(workdir: string, version: string, pkg: string): string {
  return join(workdir, version, pkg.slice(SCOPE.length))
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * npm から tgz を取得して展開する(副作用)。既に展開済みなら何もしない。
 * 成功したら true、失敗したら中途半端な展開先を消して false を返す。
 */
async function fetchPackage(workdir: string, version: string, pkg: string): Promise<boolean> {
  const target = packageDir(workdir, version, pkg)
  if (await exists(target)) return true
  const packDir = join(workdir, '.tgz')
  await mkdir(packDir, { recursive: true })
  let tgz: string | undefined
  try {
    const { stdout } = await execFileAsync('npm', [
      'pack',
      `${pkg}@${version}`,
      '--pack-destination',
      packDir,
      '--cache',
      join(workdir, 'npm-cache'),
    ])
    const printed = stdout.trim().split('\n').filter(Boolean).pop() ?? ''
    tgz = printed.includes('/') ? printed : join(packDir, printed)
    await mkdir(target, { recursive: true })
    // npm の tgz は package/ を先頭に持つため、それを外して展開先へ直接置く。
    await execFileAsync('tar', ['-xzf', tgz, '-C', target, '--strip-components=1'])
    return true
  } catch (error) {
    console.error(`[dsh-compat] 取得に失敗: ${pkg}@${version}: ${(error as Error).message.split('\n')[0]}`)
    await rm(target, { recursive: true, force: true })
    return false
  } finally {
    if (tgz) await rm(tgz, { force: true })
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(abs)))
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

/** 展開済みパッケージの相対パス → 内容のハッシュを作る(副作用)。 */
async function hashFiles(dir: string): Promise<FileList> {
  const files: FileList = {}
  for (const abs of await listFiles(dir)) {
    const path = relative(dir, abs).split(sep).join('/')
    files[path] = createHash('sha256').update(await readFile(abs)).digest('hex')
  }
  return files
}

function printResult(version: string, pkg: string, verdict: string, details: string[] = []): void {
  console.log(`${version}\t${pkg}\t${verdict}`)
  for (const line of details.slice(0, MAX_DETAILS)) console.log(`\t${line}`)
  if (details.length > MAX_DETAILS) console.log(`\t... 他 ${details.length - MAX_DETAILS} 件`)
}

async function main(argv: string[]): Promise<number> {
  const [workdir, baseVersion, ...compareVersions] = argv
  if (!workdir || !baseVersion || compareVersions.length === 0) {
    console.error('使い方: node scripts/dsh-compat.ts <作業ディレクトリ> <基準の版> <比べる版...>')
    console.error('例: node scripts/dsh-compat.ts /var/tmp/dsh-compat 0.2.1-rc.1 0.2.1-rc.2')
    return 1
  }
  await mkdir(workdir, { recursive: true })

  let failed = false
  const base = new Map<string, FileList>()
  const baseOk = new Set<string>()
  for (const pkg of PACKAGES) {
    if (await fetchPackage(workdir, baseVersion, pkg)) {
      baseOk.add(pkg)
      base.set(pkg, await hashFiles(packageDir(workdir, baseVersion, pkg)))
    } else {
      failed = true
    }
  }

  for (const version of compareVersions) {
    for (const pkg of PACKAGES) {
      if (!baseOk.has(pkg) || !(await fetchPackage(workdir, version, pkg))) {
        failed = true
        printResult(version, pkg, 'missing')
        continue
      }
      const diff = diffFileLists(base.get(pkg) ?? {}, await hashFiles(packageDir(workdir, version, pkg)))
      const details = diff.verdict === 'diff'
        ? [
            ...diff.added.map((path) => `+ ${path}`),
            ...diff.removed.map((path) => `- ${path}`),
            ...diff.changed.map((path) => `~ ${path}`),
          ]
        : []
      printResult(version, pkg, diff.verdict, details)
    }
  }
  return failed ? 1 : 0
}

// テストから import されたときは実行しない。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
