/**
 * T26b: src/index.ts (createRuntime / apply) と src/archive.ts (createDeps / isActiveSessionError) のテスト。
 * DSH 本体には触れず、注入点 (CycleDeps / RuntimeIO / ctx) を偽物に差し替えて検証する。
 * src/ は変更しない。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDeps, isActiveSessionError, type ArchiveServices } from '../src/archive.ts'
import type { AgentLike, CommandResult, PreStepDecision, PreStepPayload, SessionLike } from '../src/block.ts'
import { parseConfig, type Config } from '../src/config.ts'
import type { CycleDeps, CycleLogger } from '../src/cycle.ts'
import type { SessionInfo } from '../src/decide.ts'
import { apply, createRuntime, type HostContext, type Runtime, type RuntimeIO } from '../src/index.ts'
import type { TimedEvent } from '../src/last-response.ts'
import type { Logger } from '../src/log.ts'
import { usageMessage } from '../src/mode.ts'
import type { State } from '../src/state.ts'

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
  return parseConfig({ idleMinutes: 60, archiveAfterMinutes: 1440, ...raw })
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

interface HarnessOptions {
  now?: number
  sessions?: readonly SessionInfo[]
  archivedIds?: readonly string[]
  listSessions?: () => Promise<readonly SessionInfo[]>
  archive?: (id: string) => Promise<void>
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
    runtime: createRuntime(config, state, deps, log, io),
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
  assert.equal(expectError(result), usageMessage())
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

interface HostHarness {
  ctx: HostContext
  onCalls: OnCall[]
  commandCalls: CommandCall[]
  intervalCalls: IntervalCall[]
  loggerMessages: string[]
}

/** 登録だけを記録する偽 ctx。 */
function makeHostHarness(): HostHarness {
  const onCalls: OnCall[] = []
  const commandCalls: CommandCall[] = []
  const intervalCalls: IntervalCall[] = []
  const loggerMessages: string[] = []
  const logger: Logger = {
    debug: (msg) => loggerMessages.push(`debug:${msg}`),
    info: (msg) => loggerMessages.push(`info:${msg}`),
    warn: (msg) => loggerMessages.push(`warn:${msg}`),
  }

  const raw = {
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
    sessions: { get: () => undefined },
  }

  return { ctx: raw as unknown as HostContext, onCalls, commandCalls, intervalCalls, loggerMessages }
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
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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
