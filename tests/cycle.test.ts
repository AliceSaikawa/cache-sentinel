import assert from 'node:assert/strict'
import test from 'node:test'

import { runCycle, type CycleDeps, type CycleLogger, type CycleMemory } from '../src/cycle.ts'
import { type Config } from '../src/config.ts'
import { type SessionInfo } from '../src/decide.ts'
import { type State } from '../src/state.ts'

const MINUTE = 60_000
const NOW = 1_700_000_000_000

interface LogEntry {
  level: 'debug' | 'info' | 'warn'
  msg: string
}

/** 指定した値だけを持つセッションを作る (既定はトップレベル・未アーカイブ・未ピン・実行中なし)。 */
function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    createdAt: 0,
    pinned: false,
    archived: false,
    ...overrides,
  }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    idleMinutes: 60,
    checkIntervalSeconds: 60,
    skipPinned: true,
    archiveExisting: false,
    maxPerCycle: 20,
    dryRun: false,
    ...overrides,
  }
}

function makeState(overrides: Partial<State> = {}): State {
  return { version: 1, baselineAt: 0, unarchivedAt: {}, ...overrides }
}

interface DepsOptions {
  now?: number
  sessions?: readonly SessionInfo[]
  archivedIds?: readonly string[]
  listSessions?: () => Promise<readonly SessionInfo[]>
  archive?: (id: string) => Promise<void>
  isActiveError?: (error: unknown) => boolean
}

interface Harness {
  deps: CycleDeps
  /** deps.archive が呼ばれた id を呼び出し順に記録する。 */
  calls: string[]
  logs: LogEntry[]
}

/** モック依存を作る。DSH もファイルも使わない。 */
function makeDeps(options: DepsOptions = {}): Harness {
  const calls: string[] = []
  const logs: LogEntry[] = []

  const log: CycleLogger = {
    debug: (msg) => {
      logs.push({ level: 'debug', msg })
    },
    info: (msg) => {
      logs.push({ level: 'info', msg })
    },
    warn: (msg) => {
      logs.push({ level: 'warn', msg })
    },
  }

  const deps: CycleDeps = {
    now: () => options.now ?? NOW,
    listSessions: options.listSessions ?? (async () => options.sessions ?? []),
    archivedIds: () => options.archivedIds ?? [],
    archive: async (id) => {
      calls.push(id)
      if (options.archive) {
        await options.archive(id)
      }
    },
    isActiveError: options.isActiveError ?? (() => false),
    log,
  }

  return { deps, calls, logs }
}

test('A1: 61 分アイドルの未ピン留めセッションをアーカイブする', async () => {
  const { deps, calls, logs } = makeDeps({
    sessions: [makeSession({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })],
  })

  const result = await runCycle(deps, makeConfig(), { state: makeState(), prevArchived: undefined })

  assert.deepEqual(result.archived, ['a'])
  assert.deepEqual(calls, ['a'])
  assert.deepEqual(result.skippedActive, [])
  assert.deepEqual(result.failed, [])
  assert.deepEqual(result.dryRunTargets, [])
  assert.deepEqual(result.state.unarchivedAt, {})
  assert.ok(logs.every((entry) => entry.level !== 'warn'))
})

test('A2: 59 分アイドルは対象外 (archive を呼ばない)', async () => {
  const { deps, calls } = makeDeps({
    sessions: [makeSession({ id: 'a', lastActivityAt: NOW - 59 * MINUTE })],
  })

  const result = await runCycle(deps, makeConfig(), { state: makeState(), prevArchived: undefined })

  assert.deepEqual(calls, [])
  assert.deepEqual(result.archived, [])
  assert.deepEqual(result.dryRunTargets, [])
})

test('A3: ピン留めと subagent は対象外 (skipPinned 既定)', async () => {
  const { deps, calls } = makeDeps({
    sessions: [
      makeSession({ id: 'pinned', lastActivityAt: NOW - 600 * MINUTE, pinned: true }),
      makeSession({ id: 'sub', origin: 'subagent', lastActivityAt: NOW - 600 * MINUTE }),
      makeSession({ id: 'child', parentSession: 'root', lastActivityAt: NOW - 600 * MINUTE }),
    ],
  })

  const result = await runCycle(deps, makeConfig(), { state: makeState(), prevArchived: undefined })

  assert.deepEqual(calls, [])
  assert.deepEqual(result.archived, [])
})

test('実行中 (isActiveError) は skippedActive に入り、他は継続し failed に入らない', async () => {
  const { deps, calls, logs } = makeDeps({
    sessions: [
      makeSession({ id: 'busy', lastActivityAt: NOW - 120 * MINUTE }),
      makeSession({ id: 'ok', lastActivityAt: NOW - 61 * MINUTE }),
    ],
    archive: async (id) => {
      if (id === 'busy') throw new Error('busy')
    },
    isActiveError: (error) => error instanceof Error && error.message === 'busy',
  })

  const result = await runCycle(deps, makeConfig(), { state: makeState(), prevArchived: undefined })

  assert.deepEqual(result.skippedActive, ['busy'])
  assert.deepEqual(result.archived, ['ok'])
  assert.deepEqual(result.failed, [])
  assert.deepEqual(calls, ['busy', 'ok'])
  assert.ok(logs.some((entry) => entry.level === 'debug'))
  assert.ok(logs.every((entry) => entry.level !== 'warn'))
})

test('A4: archiveExisting=false は baseline より前を除外し、true で対象', async () => {
  const session = makeSession({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })
  const baselineAt = NOW - 30 * MINUTE

  const off = makeDeps({ sessions: [session] })
  const offResult = await runCycle(off.deps, makeConfig({ archiveExisting: false }), {
    state: makeState({ baselineAt }),
    prevArchived: undefined,
  })
  assert.deepEqual(offResult.archived, [])

  const on = makeDeps({ sessions: [session] })
  const onResult = await runCycle(on.deps, makeConfig({ archiveExisting: true }), {
    state: makeState({ baselineAt }),
    prevArchived: undefined,
  })
  assert.deepEqual(onResult.archived, ['a'])
})

test('A4: baseline ちょうど一致なら archiveExisting=false でも対象', async () => {
  const lastActivityAt = NOW - 61 * MINUTE
  const { deps } = makeDeps({ sessions: [makeSession({ id: 'a', lastActivityAt })] })

  const result = await runCycle(deps, makeConfig({ archiveExisting: false }), {
    state: makeState({ baselineAt: lastActivityAt }),
    prevArchived: undefined,
  })

  assert.deepEqual(result.archived, ['a'])
})

test('A5: 手動解除直後は猶予で再アーカイブされず、60 分超でされる', async () => {
  const session = makeSession({ id: 'a', lastActivityAt: NOW - 600 * MINUTE })

  // サイクル 1: 前回 archived に 'a' があり、今回ない → 解除を検出して unarchivedAt[a] = now
  const c1 = makeDeps({ now: NOW, sessions: [session], archivedIds: [] })
  const r1 = await runCycle(c1.deps, makeConfig(), {
    state: makeState(),
    prevArchived: new Set(['a']),
  })
  assert.deepEqual(r1.archived, [])
  assert.equal(r1.state.unarchivedAt['a'], NOW)
  assert.equal(r1.stateChanged, true)

  // サイクル 2: 解除から 30 分 → まだ猶予内
  const c2 = makeDeps({ now: NOW + 30 * MINUTE, sessions: [session], archivedIds: [] })
  const r2 = await runCycle(c2.deps, makeConfig(), {
    state: r1.state,
    prevArchived: r1.prevArchived,
  })
  assert.deepEqual(r2.archived, [])

  // サイクル 3: 解除から 61 分 → 対象に戻る
  const c3 = makeDeps({ now: NOW + 61 * MINUTE, sessions: [session], archivedIds: [] })
  const r3 = await runCycle(c3.deps, makeConfig(), {
    state: r2.state,
    prevArchived: r2.prevArchived,
  })
  assert.deepEqual(r3.archived, ['a'])
})

test('A6: dryRun では archive を呼ばず dryRunTargets に入れて info ログを出す', async () => {
  const { deps, calls, logs } = makeDeps({
    sessions: [
      makeSession({ id: 'a', lastActivityAt: NOW - 120 * MINUTE }),
      makeSession({ id: 'b', lastActivityAt: NOW - 61 * MINUTE }),
    ],
  })

  const result = await runCycle(deps, makeConfig({ dryRun: true }), {
    state: makeState(),
    prevArchived: undefined,
  })

  assert.deepEqual(calls, [])
  assert.deepEqual(result.archived, [])
  assert.deepEqual(result.dryRunTargets, ['a', 'b'])
  assert.equal(result.stateChanged, false)
  assert.equal(logs.filter((entry) => entry.level === 'info').length, 2)
})

test('A8: archive が例外を投げても他の id は処理され、warn に id とメッセージが出る', async () => {
  const { deps, calls, logs } = makeDeps({
    sessions: [
      makeSession({ id: 'bad', lastActivityAt: NOW - 120 * MINUTE }),
      makeSession({ id: 'good', lastActivityAt: NOW - 61 * MINUTE }),
    ],
    archive: async (id) => {
      if (id === 'bad') throw new Error('boom')
    },
  })

  const result = await runCycle(deps, makeConfig(), { state: makeState(), prevArchived: undefined })

  assert.deepEqual(result.archived, ['good'])
  assert.deepEqual(result.failed, ['bad'])
  assert.deepEqual(calls, ['bad', 'good'])
  const warn = logs.find((entry) => entry.level === 'warn')
  assert.ok(warn)
  assert.ok(warn.msg.includes('bad'))
  assert.ok(warn.msg.includes('boom'))
})

test('maxPerCycle の上限までしか処理しない (残りは次回)', async () => {
  const { deps, calls } = makeDeps({
    sessions: [
      makeSession({ id: 'a', lastActivityAt: NOW - 120 * MINUTE }),
      makeSession({ id: 'b', lastActivityAt: NOW - 110 * MINUTE }),
      makeSession({ id: 'c', lastActivityAt: NOW - 100 * MINUTE }),
    ],
  })

  const result = await runCycle(deps, makeConfig({ maxPerCycle: 2 }), {
    state: makeState(),
    prevArchived: undefined,
  })

  assert.deepEqual(calls, ['a', 'b'])
  assert.deepEqual(result.archived, ['a', 'b'])
})

test('初回 (prevArchived undefined) は解除を検出しない', async () => {
  const { deps } = makeDeps({ sessions: [], archivedIds: ['a', 'b'] })

  const result = await runCycle(deps, makeConfig(), {
    state: makeState(),
    prevArchived: undefined,
  })

  assert.deepEqual(result.state.unarchivedAt, {})
  assert.equal(result.stateChanged, false)
  assert.deepEqual([...result.prevArchived], ['a', 'b'])
})

test('自分がアーカイブした id は次サイクルで解除扱いされない', async () => {
  const session = makeSession({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })

  const c1 = makeDeps({ now: NOW, sessions: [session], archivedIds: [] })
  const r1 = await runCycle(c1.deps, makeConfig(), {
    state: makeState(),
    prevArchived: undefined,
  })
  assert.deepEqual(r1.archived, ['a'])
  assert.deepEqual([...r1.prevArchived], ['a'])

  // 次サイクル: 'a' が archivedSessionIds に現れる (自分のアーカイブ)
  const archivedSession = makeSession({ id: 'a', lastActivityAt: NOW - 61 * MINUTE, archived: true })
  const c2 = makeDeps({ now: NOW + MINUTE, sessions: [archivedSession], archivedIds: ['a'] })
  const r2 = await runCycle(c2.deps, makeConfig(), {
    state: r1.state,
    prevArchived: r1.prevArchived,
  })

  assert.deepEqual(r2.state.unarchivedAt, {})
  assert.equal(r2.stateChanged, false)
  assert.deepEqual(r2.archived, [])
})

test('stateChanged: prune で unarchivedAt のキーが消えたら true', async () => {
  const { deps } = makeDeps({ sessions: [], archivedIds: ['gone'] })

  const result = await runCycle(deps, makeConfig(), {
    state: makeState({ unarchivedAt: { gone: NOW - 1000 } }),
    prevArchived: new Set(['gone']),
  })

  assert.deepEqual(result.state.unarchivedAt, {})
  assert.equal(result.stateChanged, true)
})

test('stateChanged: 記録の追加も prune の変化もなければ false', async () => {
  const { deps } = makeDeps({
    sessions: [makeSession({ id: 'a', lastActivityAt: NOW })],
    archivedIds: [],
  })

  const result = await runCycle(deps, makeConfig(), {
    state: makeState({ unarchivedAt: { a: NOW - 1000 } }),
    prevArchived: new Set(),
  })

  assert.deepEqual(result.state.unarchivedAt, { a: NOW - 1000 })
  assert.equal(result.stateChanged, false)
})

test('listSessions の例外は握りつぶさず伝播する', async () => {
  const { deps } = makeDeps({
    listSessions: async () => {
      throw new Error('list failed')
    },
  })

  await assert.rejects(
    runCycle(deps, makeConfig(), { state: makeState(), prevArchived: undefined }),
    /list failed/,
  )
})

test('入力 memory を変更しない (state と prevArchived を破壊しない)', async () => {
  const memoryState = makeState({ baselineAt: NOW - 10 * MINUTE, unarchivedAt: { x: NOW - 5 * MINUTE } })
  const memory: CycleMemory = { state: memoryState, prevArchived: new Set(['a', 'b']) }
  const stateSnapshot = structuredClone(memoryState)
  const prevSnapshot = [...memory.prevArchived!]

  const { deps } = makeDeps({
    sessions: [makeSession({ id: 'a', lastActivityAt: NOW - 61 * MINUTE })],
    archivedIds: ['b'],
  })

  const result = await runCycle(deps, makeConfig(), memory)

  assert.deepEqual(memoryState, stateSnapshot)
  assert.deepEqual([...memory.prevArchived!], prevSnapshot)
  assert.notEqual(result.state, memoryState)
  assert.notEqual(result.prevArchived, memory.prevArchived)
  // 'a' は解除として記録される (prev の 'a' が archivedIds にない)。
  // 'x' は既知のセッションでないため prune で除去される。
  assert.deepEqual(result.state.unarchivedAt, { a: NOW })
  assert.equal(result.state.baselineAt, NOW - 10 * MINUTE)
})
