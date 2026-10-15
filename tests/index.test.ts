import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apply,
  createSentinel,
  type AgentLike,
  type CommandResult,
  type HostContext,
  type PreStepDecision,
  type PreStepPayload,
  type SessionLike,
} from '../src/index.ts'
import type { Config } from '../src/config.ts'
import type { TimedEvent } from '../src/last-response.ts'
import type { Logger } from '../src/log.ts'

const MINUTE = 60_000
const NOW = 1_700_000_000_000

const CONFIG: Config = { idleMinutes: 60, unlockTtlMinutes: 10, dryRun: false }

/** イベント列を返す偽 Session。snapshotEvents の呼び出し回数を数える。 */
function sessionWith(id: string, events: () => readonly TimedEvent[]) {
  const state = { calls: 0 }
  const session: SessionLike = {
    id,
    snapshotEvents() {
      state.calls += 1
      return events()
    },
  }
  return { session, state }
}

function agentOf(session: SessionLike): AgentLike {
  return { session }
}

function payload(session: SessionLike, turn = 1, step = 1): PreStepPayload {
  return { agent: agentOf(session), turn, step }
}

/** 呼ばれた回数を数え、与えられた decision をそのまま返す next。 */
function nextSpy(decision: PreStepDecision = { kind: 'enter' }) {
  const state = { calls: 0 }
  const next = async (): Promise<PreStepDecision> => {
    state.calls += 1
    return decision
  }
  return { next, decision, calls: () => state.calls }
}

/** レベルごとに記録するロガー。 */
function makeLogger() {
  const debug: string[] = []
  const info: string[] = []
  const warn: string[] = []
  const log: Logger = {
    debug: (m) => {
      debug.push(m)
    },
    info: (m) => {
      info.push(m)
    },
    warn: (m) => {
      warn.push(m)
    },
  }
  return { log, debug, info, warn }
}

/** 配列のどれかが条件を満たすか。失敗時に全要素を出す。 */
function someMessage(messages: readonly string[], predicate: (m: string) => boolean): boolean {
  assert.ok(messages.some(predicate), `該当するログがありません:\n${messages.join('\n')}`)
  return true
}

function textOf(result: CommandResult): string {
  assert.ok(result.kind === 'success', 'success を期待しました')
  return result.text ?? ''
}

test('B1: 最終応答から 61 分経過すると reject を返し next を呼ばない', async () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)
  const pass = nextSpy()

  const result = await sentinel.onPreStep(payload(session), pass.next)

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
})

test('B2: 59 分・ちょうど 60 分・応答なしは next の戻り値を素通しする', async () => {
  const cases: Array<{ label: string; events: readonly TimedEvent[] }> = [
    { label: '59 分', events: [{ type: 'step/end', time: NOW - 59 * MINUTE }] },
    { label: 'ちょうど 60 分', events: [{ type: 'step/end', time: NOW - 60 * MINUTE }] },
    { label: '新規(step/end なし)', events: [] },
  ]

  for (const { label, events } of cases) {
    const log = makeLogger()
    const { session } = sessionWith('s1', () => events)
    const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)
    const pass = nextSpy({ kind: 'enter', marker: label })

    const result = await sentinel.onPreStep(payload(session), pass.next)

    assert.equal(result, pass.decision, label)
    assert.equal(pass.calls(), 1, label)
  }
})

test('B3: unlock で通り、その後の応答を観測しても通り続ける', async () => {
  const clock = { now: NOW }
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => clock.now)

  const unlocked = sentinel.unlock(agentOf(session))
  assert.match(textOf(unlocked), /^次の送信を許可しました。/)

  const pass1 = nextSpy()
  assert.equal(await sentinel.onPreStep(payload(session), pass1.next), pass1.decision)
  assert.equal(pass1.calls(), 1)

  // 許可後の応答を観測する。許可は役目を終えるが、経過が短いので通る。
  clock.now = NOW + MINUTE
  sentinel.onSessionEvent(session, { type: 'step/end', time: NOW + MINUTE })

  const pass2 = nextSpy()
  assert.equal(await sentinel.onPreStep(payload(session), pass2.next), pass2.decision)
  assert.equal(pass2.calls(), 1)
})

test('B4: unlock から unlockTtlMinutes+1 分後は reject', async () => {
  const clock = { now: NOW }
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => clock.now)

  sentinel.unlock(agentOf(session))

  clock.now = NOW + 11 * MINUTE
  const pass = nextSpy()
  const result = await sentinel.onPreStep(payload(session), pass.next)

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
})

test('B5: 許可後に応答があれば、再び失効したときは reject(許可は再利用されない)', async () => {
  const clock = { now: NOW }
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => clock.now)

  sentinel.unlock(agentOf(session))

  clock.now = NOW + MINUTE
  sentinel.onSessionEvent(session, { type: 'step/end', time: NOW + MINUTE })

  clock.now = NOW + 62 * MINUTE
  const pass = nextSpy()
  const result = await sentinel.onPreStep(payload(session), pass.next)

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
})

test('B7: dryRun では reject せず next を呼び、info ログに dryRun を出す', async () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG, dryRun: true }, log.log, () => NOW)
  const pass = nextSpy()

  const result = await sentinel.onPreStep(payload(session), pass.next)

  assert.equal(result, pass.decision)
  assert.equal(pass.calls(), 1)
  someMessage(log.info, (m) => m.includes('dryRun'))
})

test('B8: snapshotEvents が例外を投げたら通り、warn を出す', async () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => {
    throw new Error('boom')
  })
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)
  const pass = nextSpy()

  const result = await sentinel.onPreStep(payload(session), pass.next)

  assert.equal(result, pass.decision)
  assert.equal(pass.calls(), 1)
  someMessage(log.warn, (m) => m.includes('判定に失敗したため通します') && m.includes('s1'))
})

test('snapshotEvents はセッションごとに 1 回だけ呼ばれる(キャッシュ)', async () => {
  const log = makeLogger()
  const a = sessionWith('a', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const b = sessionWith('b', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  await sentinel.onPreStep(payload(a.session), nextSpy().next)
  await sentinel.onPreStep(payload(a.session), nextSpy().next)
  await sentinel.onPreStep(payload(a.session), nextSpy().next)
  assert.equal(a.state.calls, 1)

  // 別セッションはそれぞれ 1 回読む。
  await sentinel.onPreStep(payload(b.session), nextSpy().next)
  assert.equal(b.state.calls, 1)
})

test('unlock: 失効していないセッションは fresh の文面を返す', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 5 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  const result = sentinel.unlock(agentOf(session))

  assert.equal(textOf(result), '最終応答から 5 分です。キャッシュは有効なのでそのまま送信できます')
})

test('unlock: 応答が無いセッションは no-response の文面を返す', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  const result = sentinel.unlock(agentOf(session))

  assert.equal(textOf(result), 'このセッションはまだモデル応答がありません')
})

test('ブロック時の info ログにセッション id と経過分数が含まれる', async () => {
  const log = makeLogger()
  const { session } = sessionWith('session-xyz', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  await sentinel.onPreStep(payload(session), nextSpy().next)

  someMessage(log.info, (m) => m.includes('session-xyz') && m.includes('61 分'))
})

interface Registered {
  name: string
  listener: unknown
  options: unknown
}

interface CommandDefinition {
  name: string
  description: string
  handler: unknown
}

/** 登録を記録する偽 ctx。 */
function makeHost() {
  const events: Registered[] = []
  const commands: CommandDefinition[] = []
  const logs: string[] = []
  const ctx = {
    on(name: string, listener: unknown, options?: unknown) {
      events.push({ name, listener, options })
      return () => true
    },
    commands: {
      register(definition: CommandDefinition) {
        commands.push(definition)
        return () => {}
      },
    },
    logger: {
      debug: (m: string) => {
        logs.push(`debug:${m}`)
      },
      info: (m: string) => {
        logs.push(`info:${m}`)
      },
      warn: (m: string) => {
        logs.push(`warn:${m}`)
      },
    },
  }
  return { ctx: ctx as unknown as HostContext, events, commands, logs }
}

test('B6: apply は agent/pre-step を prepend: true で登録する', (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})
  const host = makeHost()

  apply(host.ctx)

  const registered = host.events.filter((e) => e.name === 'agent/pre-step')
  assert.equal(registered.length, 1)
  const first = registered[0]
  assert.ok(first !== undefined)
  assert.deepEqual(first.options, { prepend: true })
})

test('apply は session/event と unlock コマンドを登録する', (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})
  const host = makeHost()

  apply(host.ctx)

  someMessage(
    host.events.map((e) => e.name),
    (m) => m === 'session/event',
  )
  someMessage(
    host.commands.map((c) => c.name),
    (m) => m === 'unlock',
  )
})

test('apply は不正な設定で例外になる(登録もしない)', (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})
  const host = makeHost()

  assert.throws(() => apply(host.ctx, { idleMinutes: 0 }))
  assert.equal(host.events.length, 0)
  assert.equal(host.commands.length, 0)
})
