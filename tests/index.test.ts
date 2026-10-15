/**
 * src/index.ts の純粋寄りの部分 (resolveHome / isActiveSessionError / createDeps) のテスト。
 * DSH 本体やファイルには触れず、ctx を手書きの偽物に差し替えて検証する。
 */
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { SessionInfo } from '../src/decide.ts'
import { createDeps, isActiveSessionError, resolveHome, type HostContext } from '../src/index.ts'

interface Snapshot {
  header: { id: string; createdAt: number; origin?: 'subagent'; parentSession?: string }
}

interface FakeCtxOptions {
  snapshots?: readonly Snapshot[]
  archivedSessionIds?: readonly string[]
  pinnedSessionIds?: readonly string[]
  /** id ごとの ownEvents 戻り値。undefined の id は sessions.get が undefined を返す。 */
  liveEvents?: Record<string, readonly { time: number }[] | undefined>
  archiveSession?: (id: string) => Promise<void>
}

interface FakeCtx {
  ctx: HostContext
  /** workspaceRegistry.archiveSession が呼ばれた id を呼び出し順に記録する。 */
  archivedCalls: string[]
  /** interval に渡された callback を実行するために保持する。 */
  intervalCallbacks: Array<() => void>
}

/** HostContext を手書きで作る。logger は何もしない。 */
function makeCtx(options: FakeCtxOptions = {}): FakeCtx {
  const archivedCalls: string[] = []
  const intervalCallbacks: Array<() => void> = []

  const ctx: HostContext = {
    workspaceRegistry: {
      archivedSessionIds: options.archivedSessionIds ?? [],
      pinnedSessionIds: options.pinnedSessionIds ?? [],
      async archiveSession(id) {
        archivedCalls.push(id)
        await options.archiveSession?.(id)
      },
    },
    sessionPersistence: {
      async list() {
        return options.snapshots ?? []
      },
    },
    sessions: {
      get(id) {
        const events = options.liveEvents?.[id]
        return events === undefined ? undefined : { ownEvents: () => events }
      },
    },
    interval(callback) {
      intervalCallbacks.push(callback)
      return () => {}
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
    },
  }

  return { ctx, archivedCalls, intervalCallbacks }
}

function emptyScan(): Promise<Map<string, number>> {
  return Promise.resolve(new Map<string, number>())
}

/** 指定 id の SessionInfo を取り出す (見つからなければテストを落とす)。 */
function infoOf(sessions: readonly SessionInfo[], id: string): SessionInfo {
  const info = sessions.find((session) => session.id === id)
  assert.ok(info, `session ${id} が見つからない`)
  return info
}

test('resolveHome: DSH_HOME があればそれを使う', () => {
  assert.equal(resolveHome({ DSH_HOME: '/custom/dsh' }), '/custom/dsh')
  // 前後の空白は trim される
  assert.equal(resolveHome({ DSH_HOME: '  /trimmed/dsh  ' }), '/trimmed/dsh')
})

test('resolveHome: 空白のみ・未設定は homedir()/.dsh', () => {
  const fallback = join(homedir(), '.dsh')
  assert.equal(resolveHome({ DSH_HOME: '   ' }), fallback)
  assert.equal(resolveHome({ DSH_HOME: '' }), fallback)
  assert.equal(resolveHome({}), fallback)
})

/** クラス名で判定できることを確認するためのダミー (DSH 本体は依存ではない)。 */
class WorkspaceActiveSessionError extends Error {}

test('isActiveSessionError: クラス名 WorkspaceActiveSessionError は true', () => {
  assert.equal(isActiveSessionError(new WorkspaceActiveSessionError('busy')), true)
})

test('isActiveSessionError: sessionId(string) と activity(配列) を持つ Error は true', () => {
  const empty = Object.assign(new Error('busy'), { sessionId: 's1', activity: [] })
  assert.equal(isActiveSessionError(empty), true)

  const withActivity = Object.assign(new Error('busy'), {
    sessionId: 's1',
    activity: [{ at: 1 }],
  })
  assert.equal(isActiveSessionError(withActivity), true)
})

test('isActiveSessionError: 通常の Error・非 Error・null は false', () => {
  assert.equal(isActiveSessionError(new Error('nope')), false)
  assert.equal(isActiveSessionError({ message: 'nope' }), false)
  assert.equal(isActiveSessionError('nope'), false)
  assert.equal(isActiveSessionError(null), false)
  assert.equal(isActiveSessionError(undefined), false)
})

test('isActiveSessionError: 形が片方だけ・型違いなら false', () => {
  assert.equal(isActiveSessionError(Object.assign(new Error('x'), { sessionId: 's1' })), false)
  assert.equal(isActiveSessionError(Object.assign(new Error('x'), { activity: [] })), false)
  assert.equal(isActiveSessionError(Object.assign(new Error('x'), { sessionId: 1, activity: [] })), false)
  assert.equal(isActiveSessionError(Object.assign(new Error('x'), { sessionId: 's1', activity: {} })), false)
})

test('createDeps: listSessions は header を写し pinned/archived を集合から付ける', async () => {
  const { ctx } = makeCtx({
    snapshots: [
      { header: { id: 'a', createdAt: 1000, origin: 'subagent', parentSession: 'root' } },
      { header: { id: 'b', createdAt: 2000 } },
    ],
    archivedSessionIds: ['b'],
    pinnedSessionIds: ['a'],
  })
  const deps = createDeps(ctx, emptyScan)

  const sessions = await deps.listSessions()

  assert.deepEqual(sessions, [
    {
      id: 'a',
      createdAt: 1000,
      pinned: true,
      archived: false,
      origin: 'subagent',
      parentSession: 'root',
    },
    { id: 'b', createdAt: 2000, pinned: false, archived: true },
  ])
  // ピンでもアーカイブ済みでもない id のフラグはすべて false
  assert.equal(infoOf(sessions, 'b').origin, undefined)
  assert.equal(infoOf(sessions, 'b').parentSession, undefined)
})

test('createDeps: lastActivityAt は mtime と live 末尾イベントの大きい方になる', async () => {
  const scan = async (): Promise<Map<string, number>> =>
    new Map([
      ['mtime-only', 9000],
      ['both-mtime', 4000],
      ['both-live', 4000],
    ])
  const { ctx } = makeCtx({
    snapshots: [
      { header: { id: 'mtime-only', createdAt: 1 } },
      { header: { id: 'live-only', createdAt: 1 } },
      { header: { id: 'both-mtime', createdAt: 1 } },
      { header: { id: 'both-live', createdAt: 1 } },
      { header: { id: 'neither', createdAt: 1 } },
      { header: { id: 'empty-live', createdAt: 1 } },
    ],
    liveEvents: {
      'live-only': [{ time: 5000 }, { time: 7000 }],
      'both-mtime': [{ time: 3000 }],
      'both-live': [{ time: 3000 }, { time: 8000 }],
      // 空配列でも落ちず、lastActivityAt は付かない
      'empty-live': [],
    },
  })
  const deps = createDeps(ctx, scan)

  const sessions = await deps.listSessions()

  assert.equal(infoOf(sessions, 'mtime-only').lastActivityAt, 9000)
  assert.equal(infoOf(sessions, 'live-only').lastActivityAt, 7000)
  assert.equal(infoOf(sessions, 'both-mtime').lastActivityAt, 4000)
  assert.equal(infoOf(sessions, 'both-live').lastActivityAt, 8000)
  // mtime も live も無ければキー自体が付かない
  assert.equal('lastActivityAt' in infoOf(sessions, 'neither'), false)
  assert.equal('lastActivityAt' in infoOf(sessions, 'empty-live'), false)
})

test('createDeps: archive は registry.archiveSession を id つきで呼ぶ', async () => {
  const { ctx, archivedCalls } = makeCtx({ archiveSession: async () => {} })
  const deps = createDeps(ctx, emptyScan)

  await deps.archive('s1')
  await deps.archive('s2')

  assert.deepEqual(archivedCalls, ['s1', 's2'])
})

test('createDeps: archive の失敗はそのまま伝播する', async () => {
  const { ctx } = makeCtx({
    archiveSession: async () => {
      throw new Error('boom')
    },
  })
  const deps = createDeps(ctx, emptyScan)

  await assert.rejects(deps.archive('s1'), /boom/)
})

test('createDeps: archivedIds は archivedSessionIds を返す', () => {
  const { ctx } = makeCtx({ archivedSessionIds: ['x', 'y'] })
  const deps = createDeps(ctx, emptyScan)

  assert.deepEqual(deps.archivedIds(), ['x', 'y'])
})

test('createDeps: now を注入できる (省略時は Date.now)', () => {
  const { ctx } = makeCtx()

  const fixed = createDeps(ctx, emptyScan, () => 123)
  assert.equal(fixed.now(), 123)

  const defaulted = createDeps(ctx, emptyScan)
  const before = Date.now()
  assert.ok(defaulted.now() >= before)
})

test('createDeps: isActiveError は isActiveSessionError を使う', () => {
  const { ctx } = makeCtx()
  const deps = createDeps(ctx, emptyScan)

  assert.equal(deps.isActiveError(new WorkspaceActiveSessionError('busy')), true)
  assert.equal(deps.isActiveError(new Error('nope')), false)
})
