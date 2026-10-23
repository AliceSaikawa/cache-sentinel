/**
 * T26b: src/index.ts (createRuntime / apply) と src/archive.ts (createDeps / isActiveSessionError) のテスト。
 * DSH 本体には触れず、注入点 (CycleDeps / RuntimeIO / ctx) を偽物に差し替えて検証する。
 * src/ は変更しない。
 */
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import test from 'node:test'

import { createDeps, isActiveSessionError, type ArchiveServices } from '../src/archive.ts'
import type { AgentLike, CommandResult, PreStepDecision, PreStepPayload, SessionLike } from '../src/block.ts'
import { parseConfig, type Config } from '../src/config.ts'
import type { CycleDeps, CycleLogger } from '../src/cycle.ts'
import type { SessionInfo } from '../src/decide.ts'
import {
  apply,
  createRuntime,
  loadInitialState,
  profileNameOf,
  statePathFor,
  statusResponse,
  STATUS_PATH,
  type HostContext,
  type Runtime,
  type RuntimeIO,
} from '../src/index.ts'
import type { TimedEvent } from '../src/last-response.ts'
import type { Locale } from '../src/i18n.ts'
import type { Logger } from '../src/log.ts'
import { usageMessage } from '../src/mode.ts'
import type { State } from '../src/state.ts'
import type { StatusPayload } from '../src/status.ts'

const MINUTE = 60_000
const NOW = 1_700_000_000_000

// ---- 偽物と共通ヘルパ ----

interface LogLine {
  level: 'debug' | 'info' | 'warn'
  msg: string
}

/** 記録のみのロガー。 */
function makeLogger(logs: LogLine[] = []): Logger {
  return {
    debug: (msg) => logs.push({ level: 'debug', msg }),
    info: (msg) => logs.push({ level: 'info', msg }),
    warn: (msg) => logs.push({ level: 'warn', msg }),
  }
}

/** 既定値を補った設定を作る。 */
function parseTestConfig(raw: Record<string, unknown> = {}): Config {
  return parseConfig({ idleMinutes: 60, archiveAfterMinutes: 1440, ...raw }, 'ja')
}

function stateWith(overrides: Partial<State> = {}): State {
  return { version: 2, unarchivedAt: {}, ...overrides }
}

function makeSessionInfo(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return { createdAt: 0, pinned: false, archived: false, ...overrides }
}

function makeSession(id: string, events: readonly TimedEvent[]): SessionLike {
  return { id, snapshotEvents: () => events }
}

function makeAgent(id: string, events: readonly TimedEvent[] = []): AgentLike {
  return { session: makeSession(id, events) }
}

function expectSuccess(result: CommandResult): string {
  if (result.kind !== 'success') assert.fail(`success を期待しました: ${JSON.stringify(result)}`)
  return result.text ?? ''
}

function expectError(result: CommandResult): string {
  if (result.kind !== 'error') assert.fail(`error を期待しました: ${JSON.stringify(result)}`)
  return result.text
}

/** パスが存在するか (テスト用)。 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** DSH_HOME を差し替え、テスト終了時に元に戻す (resolveHome は process.env を読む)。 */
function useDshHome(t: test.TestContext, home: string): void {
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  })
}

/** apply の表示言語を固定する(apply は LC_ALL などの環境から決めるので、CI の言語に依存させない)。 */
function useLocaleEnv(t: test.TestContext, value: string): void {
  const before = process.env.LC_ALL
  process.env.LC_ALL = value
  t.after(() => {
    if (before === undefined) delete process.env.LC_ALL
    else process.env.LC_ALL = before
  })
}

interface HarnessOptions {
  now?: number
  sessions?: readonly SessionInfo[]
  archivedIds?: readonly string[]
  listSessions?: () => Promise<readonly SessionInfo[]>
  archive?: (id: string) => Promise<void>
  /** 表示言語。既定は 'ja'(既存テストの期待値に合わせる)。 */
  locale?: Locale
}

interface Harness {
  runtime: Runtime
  /** deps.archive に渡された id (呼び出し順)。 */
  archived: string[]
  /** io.save に渡された state (呼び出し順)。 */
  saved: State[]
  logs: LogLine[]
  /** listSessions が呼ばれた回数。 */
  listCalls: () => number
}

/** createRuntime を偽の CycleDeps / RuntimeIO で組み立てる。 */
function makeHarness(config: Config, state: State = stateWith(), options: HarnessOptions = {}): Harness {
  const now = options.now ?? NOW
  const sessions = options.sessions ?? []
  const archived: string[] = []
  const saved: State[] = []
  const logs: LogLine[] = []
  let listCalls = 0

  const log = makeLogger(logs)
  const deps: CycleDeps = {
    now: () => now,
    listSessions: async () => {
      listCalls += 1
      return options.listSessions ? await options.listSessions() : sessions
    },
    archivedIds: () => options.archivedIds ?? [],
    archive: async (id) => {
      archived.push(id)
      if (options.archive) await options.archive(id)
    },
    isActiveError: () => false,
    log,
  }
  const io: RuntimeIO = {
    now: () => now,
    save: async (next) => {
      saved.push(next)
    },
  }

  return {
    runtime: createRuntime(config, state, deps, log, io, options.locale ?? 'ja'),
    archived,
    saved,
    logs,
    listCalls: () => listCalls,
  }
}

// ---- (1) 実効モード ----

test('T26b (1): 実効モードは state.mode を優先し、無ければ config.mode', () => {
  const config = parseTestConfig({ mode: 'both' })

  assert.equal(makeHarness(config, stateWith()).runtime.mode(), 'both')
  assert.equal(makeHarness(config, stateWith({ mode: 'off' })).runtime.mode(), 'off')
})

// ---- (2) /sentinel (引数なし) ----

test('T26b (2): /sentinel は success で状態文面を返す', async () => {
  const h = makeHarness(parseTestConfig({ mode: 'block' }), stateWith())

  const result = await h.runtime.sentinel(makeAgent('s1'), '')
  const text = expectSuccess(result)
  const firstLine = text.split('\n')[0] ?? ''

  assert.ok(firstLine.includes('モード block'), firstLine)
  assert.ok(firstLine.includes('YAML の設定'), firstLine)
  assert.equal(h.saved.length, 0)
})

// ---- (3) /sentinel archive → default ----

test('T26b (3): /sentinel archive は baselineAt を保存し、default で mode を消す', async () => {
  const config = parseTestConfig({ mode: 'block' })
  const h = makeHarness(config, stateWith())
  const agent = makeAgent('s1')

  const toArchive = expectSuccess(await h.runtime.sentinel(agent, 'archive'))
  assert.equal(h.runtime.mode(), 'archive')

  const archivedState = h.saved.at(-1)
  assert.ok(archivedState, 'archive への変更で io.save が呼ばれる')
  assert.equal(archivedState.mode, 'archive')
  assert.equal(archivedState.baselineAt, NOW)
  assert.ok((toArchive.split('\n')[0] ?? '').includes('モード archive'))

  const toDefault = expectSuccess(await h.runtime.sentinel(agent, 'default'))
  assert.equal(h.runtime.mode(), 'block')

  const defaultState = h.saved.at(-1)
  assert.ok(defaultState, 'default への変更で io.save が呼ばれる')
  assert.equal('mode' in defaultState, false)
  assert.equal(defaultState.baselineAt, NOW)
  assert.ok((toDefault.split('\n')[0] ?? '').includes('モード block'))
})

// ---- (4) /sentinel 不明な引数 ----

test('T26b (4): /sentinel の不明な引数は error で使い方を返す', async () => {
  const h = makeHarness(parseTestConfig(), stateWith())

  const result = await h.runtime.sentinel(makeAgent('s1'), 'xyz')

  assert.equal(result.kind, 'error')
  assert.equal(expectError(result), usageMessage('ja'))
})

// ---- (5) tick のモード別の振る舞い ----

test('T26b (5): block モードの tick は archive も listSessions も呼ばない', async () => {
  const h = makeHarness(parseTestConfig({ mode: 'block' }), stateWith({ mode: 'block' }), {
    sessions: [makeSessionInfo({ id: 'stale', lastActivityAt: NOW - 100_000 * MINUTE })],
  })

  await h.runtime.tick()

  assert.deepEqual(h.archived, [])
  assert.equal(h.listCalls(), 0)
  assert.deepEqual(h.saved, [])
})

test('T26b (5): archive モードの tick は idleMinutes 超(基準時刻以降)をアーカイブする', async () => {
  const baselineAt = NOW - 1000 * MINUTE
  const h = makeHarness(parseTestConfig({ mode: 'archive', idleMinutes: 60 }), stateWith({ mode: 'archive', baselineAt }), {
    sessions: [
      makeSessionInfo({ id: 'stale', createdAt: baselineAt, lastActivityAt: NOW - 61 * MINUTE }),
      makeSessionInfo({ id: 'fresh', createdAt: baselineAt, lastActivityAt: NOW - 59 * MINUTE }),
      makeSessionInfo({ id: 'before', createdAt: baselineAt, lastActivityAt: baselineAt - 1 }),
    ],
  })

  await h.runtime.tick()

  assert.deepEqual(h.archived, ['stale'])
})

test('T26b (5): both モードは archiveAfterMinutes 以下ならアーカイブせず、超えたらする', async () => {
  const baselineAt = NOW - 3000 * MINUTE
  const h = makeHarness(
    parseTestConfig({ mode: 'both', idleMinutes: 60, archiveAfterMinutes: 1440 }),
    stateWith({ mode: 'both', baselineAt }),
    {
      sessions: [
        makeSessionInfo({ id: 'at60', createdAt: baselineAt, lastActivityAt: NOW - 61 * MINUTE }),
        makeSessionInfo({ id: 'at1440', createdAt: baselineAt, lastActivityAt: NOW - 1440 * MINUTE }),
        makeSessionInfo({ id: 'over', createdAt: baselineAt, lastActivityAt: NOW - 1441 * MINUTE }),
      ],
    },
  )

  await h.runtime.tick()

  assert.deepEqual(h.archived, ['over'])
})

test('T26b (5): off モードの tick は何もしない', async () => {
  const h = makeHarness(parseTestConfig({ mode: 'off' }), stateWith({ mode: 'off' }), {
    sessions: [makeSessionInfo({ id: 'stale', lastActivityAt: NOW - 100_000 * MINUTE })],
  })

  await h.runtime.tick()

  assert.deepEqual(h.archived, [])
  assert.equal(h.listCalls(), 0)
  assert.deepEqual(h.saved, [])
})

// ---- (6) baselineAt の無い archive の初回 tick (C4) ----

test('T26b (6): baselineAt が無い archive の初回 tick は基準を保存し、以前のセッションを対象外にする (C4)', async () => {
  const h = makeHarness(parseTestConfig({ mode: 'archive', idleMinutes: 60 }), stateWith({ mode: 'archive' }), {
    sessions: [makeSessionInfo({ id: 'old', lastActivityAt: NOW - 61 * MINUTE })],
  })

  await h.runtime.tick()

  assert.deepEqual(h.archived, [])
  assert.equal(h.saved.length, 1)
  const saved = h.saved[0]
  assert.ok(saved)
  assert.equal(saved.baselineAt, NOW)
})

// ---- (7) onPreStep のモード別ゲート (C1) ----

test('T26b (7): block は失効セッションで reject、archive は同じセッションでも next を呼ぶ (C1)', async () => {
  const events: readonly TimedEvent[] = [{ type: 'step/end', time: NOW - 61 * MINUTE }]
  const payload: PreStepPayload = { agent: makeAgent('s1', events), turn: 1, step: 1 }

  const blockHarness = makeHarness(parseTestConfig({ mode: 'block', idleMinutes: 60 }), stateWith())
  let blockNext = 0
  const blocked = await blockHarness.runtime.onPreStep(payload, async (): Promise<PreStepDecision> => {
    blockNext += 1
    return { kind: 'enter' }
  })
  assert.equal(blocked.kind, 'reject')
  assert.equal(blockNext, 0)

  const archiveHarness = makeHarness(parseTestConfig({ mode: 'archive', idleMinutes: 60 }), stateWith())
  let archiveNext = 0
  const passed = await archiveHarness.runtime.onPreStep(payload, async (): Promise<PreStepDecision> => {
    archiveNext += 1
    return { kind: 'enter' }
  })
  assert.equal(passed.kind, 'enter')
  assert.equal(archiveNext, 1)
})

// ---- (8) archive モードの /unlock ----

test('T26b (8): archive モードの unlock は入力禁止が無効である旨を返す', () => {
  const h = makeHarness(parseTestConfig({ mode: 'archive' }), stateWith())

  assert.equal(expectSuccess(h.runtime.unlock(makeAgent('s1'))), '入力禁止は無効です(モード: archive)')
})

// ---- (9) tick の再入防止 ----

test('T26b (9): tick の実行中に再度 tick しても listSessions は 1 回だけ', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const h = makeHarness(
    parseTestConfig({ mode: 'archive' }),
    stateWith({ mode: 'archive', baselineAt: NOW - 1000 * MINUTE }),
    {
      listSessions: async () => {
        await gate
        return []
      },
    },
  )

  const first = h.runtime.tick()
  const second = h.runtime.tick()
  release?.()
  await Promise.all([first, second])

  assert.equal(h.listCalls(), 1)
})

// ---- (10) apply の登録 ----

interface OnCall {
  name: string
  options: unknown
}

interface CommandCall {
  name: string
  description: string
  handler: unknown
}

interface IntervalCall {
  delayMs: number
}

type SessionEntry = SessionLike & { ownEvents(): readonly { time: number }[] }

interface RouteCall {
  path: string
  methods: string[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
}

interface HostHarness {
  ctx: HostContext
  onCalls: OnCall[]
  commandCalls: CommandCall[]
  intervalCalls: IntervalCall[]
  /** connection.fetch.register に渡された route (呼び出し順)。 */
  routeCalls: RouteCall[]
  loggerMessages: string[]
}

interface HostHarnessOptions {
  /** ctx.sessions.get が返すセッション。既定は undefined(読み込まれていない)。 */
  sessionGet?: (id: string) => SessionEntry | undefined
  /** ctx.get('profileContext') が返すプロファイル名。既定は undefined(provide されていないホスト)。 */
  profileName?: string
}

/** 登録だけを記録する偽 ctx。 */
function makeHostHarness(options: HostHarnessOptions = {}): HostHarness {
  const onCalls: OnCall[] = []
  const commandCalls: CommandCall[] = []
  const intervalCalls: IntervalCall[] = []
  const routeCalls: RouteCall[] = []
  const loggerMessages: string[] = []
  const logger: Logger = {
    debug: (msg) => loggerMessages.push(`debug:${msg}`),
    info: (msg) => loggerMessages.push(`info:${msg}`),
    warn: (msg) => loggerMessages.push(`warn:${msg}`),
  }

  const raw = {
    get(name: string) {
      return name === 'profileContext' && options.profileName !== undefined
        ? { name: options.profileName }
        : undefined
    },
    on(name: string, _listener: unknown, options?: unknown) {
      onCalls.push({ name, options })
      return () => true
    },
    commands: {
      register(definition: { name: string; description: string; handler: unknown }) {
        commandCalls.push(definition)
        return () => true
      },
    },
    interval(_callback: () => void, delayMs: number) {
      intervalCalls.push({ delayMs })
      return () => true
    },
    logger,
    workspaceRegistry: {
      archivedSessionIds: [] as readonly string[],
      pinnedSessionIds: [] as readonly string[],
      archiveSession: async () => {},
    },
    sessionPersistence: { list: async () => [] },
    sessions: { get: (id: string) => options.sessionGet?.(id) },
    connection: {
      fetch: {
        register(route: RouteCall) {
          routeCalls.push(route)
          return {}
        },
      },
    },
  }

  return { ctx: raw as unknown as HostContext, onCalls, commandCalls, intervalCalls, routeCalls, loggerMessages }
}

test('T26b (10): apply は pre-step(prepend)・session/event・2 コマンド・interval を登録する', async (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})

  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-index-'))
  const host = makeHostHarness()

  try {
    await apply(host.ctx, { stateFile: join(dir, 'state.json'), checkIntervalSeconds: 30 })

    const preStep = host.onCalls.filter((call) => call.name === 'agent/pre-step')
    assert.equal(preStep.length, 1)
    assert.deepEqual(preStep[0]?.options, { prepend: true })
    assert.ok(host.onCalls.some((call) => call.name === 'session/event'))

    assert.deepEqual(host.commandCalls.map((call) => call.name).sort(), ['sentinel', 'unlock'])

    assert.equal(host.intervalCalls.length, 1)
    assert.equal(host.intervalCalls[0]?.delayMs, 30_000)

    assert.ok(host.loggerMessages.some((msg) => msg.startsWith('info:開始')))

    // 状態の取得口 (spec-ui.md §E1) を STATUS_PATH の GET で登録する。
    assert.equal(host.routeCalls.length, 1)
    const route = host.routeCalls[0]
    assert.ok(route)
    assert.equal(route.path, STATUS_PATH)
    assert.deepEqual(route.methods, ['GET'])
    assert.equal(route.requestBody, 'buffered')

    const response = await route.fetch(new Request(`http://x${STATUS_PATH}?sessionId=s1`))
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /application\/json/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    // 偽 ctx の sessions.get は undefined を返すので、読み込まれていないセッション = unknown。
    const body = (await response.json()) as StatusPayload
    assert.equal(body.state, 'unknown')
    assert.equal(body.mode, 'block')
    assert.equal(body.gate, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- (10d) プロファイル別の state.json (Issue #9) ----

/** apply を実ファイルで動かすテストの共通準備。DSH_HOME を一時ディレクトリにし、表示言語を日本語に固定する。 */
async function useTempHome(t: test.TestContext): Promise<{ dir: string; home: string; legacyFile: string }> {
  useLocaleEnv(t, 'ja_JP.UTF-8')
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-index-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const home = join(dir, 'home')
  useDshHome(t, home)
  return { dir, home, legacyFile: join(home, 'cache-sentinel', 'state.json') }
}

/** apply が登録した /sentinel を実行し、出力の 1 行目(モードの行)を返す。 */
async function runSentinel(host: HostHarness, rawInput: string): Promise<string> {
  const sentinel = host.commandCalls.find((call) => call.name === 'sentinel')
  assert.ok(sentinel, 'sentinel コマンドが登録されている')
  const handler = sentinel.handler as (invocation: { agent: AgentLike; rawInput: string }) => Promise<CommandResult>
  return expectSuccess(await handler({ agent: makeAgent('s1'), rawInput })).split('\n')[0] ?? ''
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

test('T39 (13): statePathFor は設定 > プロファイル別 > 従来の共有 の順に場所を決める (#9)', () => {
  const home = '/home/u/.dsh'

  // プロファイル名あり: profiles/<名前>/state.json。移行元は従来の共有ファイル。
  assert.deepEqual(statePathFor(home, 'web', undefined, posix), {
    file: '/home/u/.dsh/cache-sentinel/profiles/web/state.json',
    legacy: '/home/u/.dsh/cache-sentinel/state.json',
  })
  // DSH が受け付ける名前 `state.json` でも、従来のファイルや一時ファイルと同じ階層にならない。
  assert.deepEqual(statePathFor(home, 'state.json', undefined, posix), {
    file: '/home/u/.dsh/cache-sentinel/profiles/state.json/state.json',
    legacy: '/home/u/.dsh/cache-sentinel/state.json',
  })

  // プロファイル名なし: 従来の共有ファイル(移行元なし)
  assert.deepEqual(statePathFor(home, undefined, undefined, posix), { file: '/home/u/.dsh/cache-sentinel/state.json' })

  // 設定 stateFile は常に優先し、移行しない(プロファイル名の有無によらない)
  assert.deepEqual(statePathFor(home, 'web', '/tmp/x/state.json', posix), { file: '/tmp/x/state.json' })
  assert.deepEqual(statePathFor(home, undefined, '/tmp/x/state.json', posix), { file: '/tmp/x/state.json' })
})

test('T39 (13): statePathFor は win32 では Windows の区切りで組み立てる (#6, #9)', () => {
  assert.deepEqual(statePathFor('C:\\Users\\u\\.dsh', 'web', undefined, win32), {
    file: 'C:\\Users\\u\\.dsh\\cache-sentinel\\profiles\\web\\state.json',
    legacy: 'C:\\Users\\u\\.dsh\\cache-sentinel\\state.json',
  })
  assert.deepEqual(statePathFor('C:\\Users\\u\\.dsh', undefined, undefined, win32), {
    file: 'C:\\Users\\u\\.dsh\\cache-sentinel\\state.json',
  })
})

test('T39 (13): profileNameOf は DSH のプロファイル名の規則に合う name だけを読む (#9)', () => {
  const nameOf = (name: unknown) => profileNameOf({ get: (key) => (key === 'profileContext' ? { name } : undefined) })
  assert.equal(nameOf('web'), 'web')
  assert.equal(nameOf('desktop'), 'desktop')
  assert.equal(nameOf('state.json'), 'state.json') // DSH は受け付ける
  // DSH の resolveProfileDir が拒否する名前は「プロファイル名なし」
  assert.equal(nameOf(''), undefined)
  assert.equal(nameOf('a/b'), undefined)
  assert.equal(nameOf('a\\b'), undefined)
  assert.equal(nameOf('.'), undefined)
  assert.equal(nameOf('..'), undefined)
  assert.equal(nameOf('node_modules'), undefined)
  // name が文字列でない / profileContext が無い / get を持たない ctx
  assert.equal(nameOf(7), undefined)
  assert.equal(profileNameOf({ get: () => ({}) }), undefined)
  assert.equal(profileNameOf({ get: () => undefined }), undefined)
  assert.equal(profileNameOf({}), undefined)
})

test('T39 (13): loadInitialState は従来の共有ファイルを 1 回だけ引き継ぎ、プロファイル別のファイルを作る (#9)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-profile-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const location = { file: join(dir, 'profiles', 'web', 'state.json'), legacy: join(dir, 'state.json') }
  await writeFile(location.legacy, '{"version":2,"mode":"off","baselineAt":111,"unarchivedAt":{"a":1}}', 'utf8')
  const host = makeHostHarness()

  // 1 回目: 従来の共有ファイルの内容を返し、同じ内容でプロファイル別のファイルを作る。共有ファイルは変えない。
  assert.deepEqual(await loadInitialState(location, host.ctx.logger), {
    version: 2,
    mode: 'off',
    baselineAt: 111,
    unarchivedAt: { a: 1 },
  })
  assert.deepEqual(await readJson(location.file), { version: 2, mode: 'off', baselineAt: 111, unarchivedAt: { a: 1 } })
  assert.deepEqual(await readJson(location.legacy), { version: 2, mode: 'off', baselineAt: 111, unarchivedAt: { a: 1 } })
  assert.deepEqual(host.loggerMessages, [
    `info:状態ファイルを作りました: ${location.file}(従来の ${location.legacy} から引き継ぎ。無ければ空の状態)`,
  ])

  // 2 回目: 共有ファイルが他のホストに書き換えられても、プロファイル別のファイルだけを読む。
  await writeFile(location.legacy, '{"version":2,"mode":"both","unarchivedAt":{}}', 'utf8')
  assert.deepEqual(await loadInitialState(location, host.ctx.logger), {
    version: 2,
    mode: 'off',
    baselineAt: 111,
    unarchivedAt: { a: 1 },
  })
  assert.equal(host.loggerMessages.length, 1)
})

test('T39 (13): loadInitialState は共有ファイルが無くても空の状態でプロファイル別のファイルを作る (#9)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-profile-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const location = { file: join(dir, 'profiles', 'web', 'state.json'), legacy: join(dir, 'state.json') }
  const host = makeHostHarness()

  assert.deepEqual(await loadInitialState(location, host.ctx.logger), { version: 2, unarchivedAt: {} })
  assert.deepEqual(await readJson(location.file), { version: 2, unarchivedAt: {} })
  assert.equal(await exists(location.legacy), false)

  // 以後、共有ファイルができても引き継がない。
  await writeFile(location.legacy, '{"version":2,"mode":"off","unarchivedAt":{}}', 'utf8')
  assert.deepEqual(await loadInitialState(location, host.ctx.logger), { version: 2, unarchivedAt: {} })
})

test('T39 (13): loadInitialState は移行元が無ければそのファイルだけを読み、ファイルを作らない (#9)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-profile-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const host = makeHostHarness()
  const file = join(dir, 'state.json')

  assert.deepEqual(await loadInitialState({ file }, host.ctx.logger), { version: 2, unarchivedAt: {} })
  assert.deepEqual(await readdir(dir), [])

  await writeFile(file, '{"version":2,"mode":"both","unarchivedAt":{}}', 'utf8')
  assert.deepEqual(await loadInitialState({ file }, host.ctx.logger), { version: 2, mode: 'both', unarchivedAt: {} })
  assert.deepEqual(host.loggerMessages, [])
})

test(
  'T39 (13): loadInitialState はプロファイル別のファイルを作れなくても読んだ内容を返し、warn を出す (#9)',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows の chmod はディレクトリの書き込みを止めない'
        : process.getuid?.() === 0
          ? 'root では書き込み権限の拒否を再現できない'
          : false,
  },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-profile-'))
    t.after(async () => {
      await chmod(join(dir, 'readonly'), 0o700).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    })
    await mkdir(join(dir, 'readonly'))
    await chmod(join(dir, 'readonly'), 0o500) // 中は見えるが、ディレクトリを作れない
    const location = { file: join(dir, 'readonly', 'profiles', 'web', 'state.json'), legacy: join(dir, 'state.json') }
    await writeFile(location.legacy, '{"version":2,"mode":"off","unarchivedAt":{}}', 'utf8')
    const host = makeHostHarness()

    assert.deepEqual(await loadInitialState(location, host.ctx.logger), { version: 2, mode: 'off', unarchivedAt: {} })
    assert.equal(await exists(join(dir, 'readonly', 'profiles')), false)
    assert.equal(host.loggerMessages.length, 1)
    assert.match(host.loggerMessages[0] ?? '', /^warn:state\.json の保存に失敗しました: Error: EACCES/)
  },
)

test('T39 (13): apply はプロファイル名に応じて state.json を分け、状態ファイルをログに出す (#9)', async (t) => {
  const { home, legacyFile } = await useTempHome(t)
  await mkdir(join(home, 'cache-sentinel'), { recursive: true })
  await writeFile(legacyFile, '{"version":2,"mode":"off","baselineAt":111,"unarchivedAt":{}}', 'utf8')

  // プロファイル名あり: 起動時に従来の共有ファイルを引き継いでプロファイル別のファイルを作る。
  const web = makeHostHarness({ profileName: 'web' })
  await apply(web.ctx, { mode: 'block' })

  const webFile = join(home, 'cache-sentinel', 'profiles', 'web', 'state.json')
  assert.deepEqual(await readJson(webFile), { version: 2, mode: 'off', baselineAt: 111, unarchivedAt: {} })
  assert.ok(web.loggerMessages.includes(`info:状態ファイル: ${webFile}`), web.loggerMessages.join('\n'))
  // 引き継いだモードが効いている(YAML は block だが、共有ファイルの mode: off)。
  assert.equal(await runSentinel(web, ''), 'cache-sentinel: モード off(/sentinel で設定、YAML の既定は block)')

  // プロファイル名なし: 従来の共有ファイルを使い、プロファイル別のファイルは作らない(後方互換)。
  const shared = makeHostHarness()
  await apply(shared.ctx, { mode: 'block' })

  assert.ok(
    shared.loggerMessages.includes(`info:状態ファイル: ${legacyFile} (プロファイル名なし)`),
    shared.loggerMessages.join('\n'),
  )
  assert.deepEqual(await readdir(join(home, 'cache-sentinel', 'profiles')), ['web'])
  assert.deepEqual(await readJson(legacyFile), { version: 2, mode: 'off', baselineAt: 111, unarchivedAt: {} })
})

test('T39 (13): プロファイル名ありの /sentinel archive はプロファイル別のファイルにだけ書く (#9)', async (t) => {
  const { home, legacyFile } = await useTempHome(t)
  await mkdir(join(home, 'cache-sentinel'), { recursive: true })
  await writeFile(legacyFile, '{"version":2,"mode":"off","baselineAt":111,"unarchivedAt":{}}', 'utf8')
  const web = makeHostHarness({ profileName: 'web' })
  await apply(web.ctx, { mode: 'block' })

  assert.equal(
    await runSentinel(web, 'archive'),
    'cache-sentinel: モード archive(/sentinel で設定、YAML の既定は block)',
  )

  assert.deepEqual(await readJson(join(home, 'cache-sentinel', 'profiles', 'web', 'state.json')), {
    version: 2,
    mode: 'archive',
    baselineAt: 111,
    unarchivedAt: {},
  })
  assert.deepEqual(await readJson(legacyFile), { version: 2, mode: 'off', baselineAt: 111, unarchivedAt: {} })
})

test('T39 (13): 同じ DSH_HOME の web と desktop は互いの state.json とモードに影響しない (#9)', async (t) => {
  const { home, legacyFile } = await useTempHome(t)
  t.mock.timers.enable({ apis: ['Date'], now: 1_792_062_384_184 }) // baselineAt を固定する(apply は Date.now を io.now に渡す)
  const webFile = join(home, 'cache-sentinel', 'profiles', 'web', 'state.json')
  const desktopFile = join(home, 'cache-sentinel', 'profiles', 'desktop', 'state.json')
  const web = makeHostHarness({ profileName: 'web' })
  const desktop = makeHostHarness({ profileName: 'desktop' })
  await apply(web.ctx, { mode: 'block' })
  await apply(desktop.ctx, { mode: 'block' })

  assert.ok(web.loggerMessages.includes(`info:状態ファイル: ${webFile}`), web.loggerMessages.join('\n'))
  assert.ok(desktop.loggerMessages.includes(`info:状態ファイル: ${desktopFile}`), desktop.loggerMessages.join('\n'))

  // web で off にしても、desktop のファイルとモードは変わらない。
  assert.equal(await runSentinel(web, 'off'), 'cache-sentinel: モード off(/sentinel で設定、YAML の既定は block)')
  assert.deepEqual(await readJson(webFile), { version: 2, mode: 'off', unarchivedAt: {} })
  assert.deepEqual(await readJson(desktopFile), { version: 2, unarchivedAt: {} })
  assert.equal(await runSentinel(desktop, ''), 'cache-sentinel: モード block(YAML の設定)')

  // desktop で both にしても、web のファイルとモードは変わらない。
  assert.equal(
    await runSentinel(desktop, 'both'),
    'cache-sentinel: モード both(/sentinel で設定、YAML の既定は block)',
  )
  assert.deepEqual(await readJson(desktopFile), {
    version: 2,
    mode: 'both',
    baselineAt: 1_792_062_384_184,
    unarchivedAt: {},
  })
  assert.deepEqual(await readJson(webFile), { version: 2, mode: 'off', unarchivedAt: {} })
  assert.equal(await runSentinel(web, ''), 'cache-sentinel: モード off(/sentinel で設定、YAML の既定は block)')

  // どちらも従来の共有ファイルには書かない。
  assert.equal(await exists(legacyFile), false)
})

test('T39 (13): 設定 stateFile はプロファイル別より優先され、従来の共有ファイルを引き継がない (#9)', async (t) => {
  const { dir, home, legacyFile } = await useTempHome(t)
  await mkdir(join(home, 'cache-sentinel'), { recursive: true })
  await writeFile(legacyFile, '{"version":2,"mode":"off","baselineAt":111,"unarchivedAt":{}}', 'utf8')
  const explicit = join(dir, 'explicit', 'state.json')
  const host = makeHostHarness({ profileName: 'web' })

  await apply(host.ctx, { stateFile: explicit, mode: 'block' })

  assert.ok(host.loggerMessages.includes(`info:状態ファイル: ${explicit}`), host.loggerMessages.join('\n'))
  assert.equal(await exists(explicit), false) // 起動時はファイルを作らない
  assert.equal(await exists(join(home, 'cache-sentinel', 'profiles')), false)
  assert.equal(await runSentinel(host, ''), 'cache-sentinel: モード block(YAML の設定)')
})

// ---- (10b) statusResponse ----

test('T35a (2): statusResponse は sessionId なし・空なら 400、あれば lookup の JSON を返す', async () => {
  const payload: StatusPayload = {
    mode: 'block',
    gate: true,
    state: 'stale',
    idleMinutes: 75,
    thresholdMinutes: 60,
    unlockExpiresAt: null,
    dryRun: false,
  }
  const seen: string[] = []
  const lookup = (sessionId: string): StatusPayload => {
    seen.push(sessionId)
    return payload
  }

  const missing = statusResponse(new Request(`http://x${STATUS_PATH}`), lookup)
  assert.equal(missing.status, 400)

  const empty = statusResponse(new Request(`http://x${STATUS_PATH}?sessionId=`), lookup)
  assert.equal(empty.status, 400)

  // 400 のときは lookup を呼ばない。
  assert.deepEqual(seen, [])

  const ok = statusResponse(new Request(`http://x${STATUS_PATH}?sessionId=s1`), lookup)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  assert.deepEqual(seen, ['s1'])
  assert.deepEqual(await ok.json(), payload)
})

// ---- (10c) runtime.status ----

test('T35a (3): runtime.status は block で失効セッションを stale、archive では inactive と mode を返す', () => {
  const events: readonly TimedEvent[] = [{ type: 'step/end', time: NOW - 61 * MINUTE }]
  const session = makeSession('s1', events)

  const blockHarness = makeHarness(parseTestConfig({ mode: 'block', idleMinutes: 60 }), stateWith())
  const stale = blockHarness.runtime.status(session)
  assert.equal(stale.mode, 'block')
  assert.equal(stale.gate, true)
  assert.equal(stale.state, 'stale')
  assert.equal(stale.idleMinutes, 61)
  assert.equal(stale.thresholdMinutes, 60)

  const archiveHarness = makeHarness(parseTestConfig({ mode: 'archive', idleMinutes: 60 }), stateWith())
  const inactive = archiveHarness.runtime.status(session)
  assert.equal(inactive.mode, 'archive')
  assert.equal(inactive.gate, false)
  assert.equal(inactive.state, 'inactive')
})

// ---- (11) createDeps / isActiveSessionError ----

test('T26b (11): createDeps は header を写し、pinned/archived を付け、lastActivityAt を max で決める', async () => {
  const archivedIds = ['arch']
  const pinnedIds = ['pin']
  const archiveCalls: string[] = []
  const services: ArchiveServices = {
    workspaceRegistry: {
      archivedSessionIds: archivedIds,
      pinnedSessionIds: pinnedIds,
      archiveSession: async (id) => {
        archiveCalls.push(id)
      },
    },
    sessionPersistence: {
      list: async () => [
        { header: { id: 'sub', createdAt: 100, origin: 'subagent', parentSession: 'root' } },
        { header: { id: 'pin', createdAt: 200 } },
        { header: { id: 'arch', createdAt: 300 } },
        { header: { id: 'live', createdAt: 400 } },
      ],
    },
    sessions: {
      get: (id) => (id === 'live' ? { ownEvents: () => [{ time: 800 }, { time: 1000 }] } : undefined),
    },
  }
  const mtimes = new Map([
    ['sub', 500],
    ['live', 900],
  ])
  const log: CycleLogger = { debug: () => {}, info: () => {}, warn: () => {} }
  const deps = createDeps(services, async () => mtimes, log, () => NOW)

  const sessions = await deps.listSessions()
  const find = (id: string): SessionInfo | undefined => sessions.find((session) => session.id === id)

  assert.equal(deps.now(), NOW)
  assert.deepEqual(deps.archivedIds(), archivedIds)

  assert.deepEqual(find('sub'), {
    id: 'sub',
    createdAt: 100,
    pinned: false,
    archived: false,
    origin: 'subagent',
    parentSession: 'root',
    lastActivityAt: 500,
  })
  assert.deepEqual(find('pin'), { id: 'pin', createdAt: 200, pinned: true, archived: false })
  assert.deepEqual(find('arch'), { id: 'arch', createdAt: 300, pinned: false, archived: true })
  // mtime (900) より live の末尾イベント (1000) が新しい
  assert.deepEqual(find('live'), {
    id: 'live',
    createdAt: 400,
    pinned: false,
    archived: false,
    lastActivityAt: 1000,
  })

  await deps.archive('x')
  assert.deepEqual(archiveCalls, ['x'])
})

test('T26b (11): isActiveSessionError はクラス名と形で判定する', () => {
  class WorkspaceActiveSessionError extends Error {}

  assert.equal(isActiveSessionError(new WorkspaceActiveSessionError('実行中')), true)
  assert.equal(
    isActiveSessionError(Object.assign(new Error('実行中'), { sessionId: 's1', activity: [] })),
    true,
  )
  assert.equal(isActiveSessionError(new Error('別の失敗')), false)
  // Error でなければ形が揃っていても false
  assert.equal(isActiveSessionError({ sessionId: 's1', activity: [] }), false)
  assert.equal(isActiveSessionError('実行中'), false)
  assert.equal(isActiveSessionError(undefined), false)
})

// ---- (12) 表示言語 (spec-ui v0.5 §F) ----

test('T38 (12): createRuntime は渡した言語で /sentinel と /unlock の出力を返す', async () => {
  const h = makeHarness(parseTestConfig({ mode: 'archive' }), stateWith(), { locale: 'en' })

  assert.equal(
    expectSuccess(h.runtime.unlock(makeAgent('s1'))),
    'Input blocking is disabled (mode: archive)',
  )

  const status = expectSuccess(await h.runtime.sentinel(makeAgent('s1'), ''))
  assert.equal(status.split('\n')[0], 'cache-sentinel: mode archive (from YAML)')

  assert.equal(expectError(await h.runtime.sentinel(makeAgent('s1'), 'xyz')), usageMessage('en'))
})
