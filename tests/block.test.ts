import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSentinel,
  type AgentLike,
  type BlockSettings,
  type CommandResult,
  type PreStepDecision,
  type PreStepPayload,
  type SessionLike,
} from '../src/block.ts'
import type { TimedEvent } from '../src/last-response.ts'
import type { Logger } from '../src/log.ts'

const MINUTE = 60_000
const NOW = 1_700_000_000_000

const CONFIG: BlockSettings = { idleMinutes: 60, unlockTtlMinutes: 10, dryRun: false }

/** 入力禁止が無効なモードで `/unlock` のときに呼び出し側が渡す文面(src/mode.ts の unlockInactiveMessage 相当)。 */
const INACTIVE_TEXT = '入力禁止は無効です(モード: off)'

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

  const unlocked = sentinel.unlock(agentOf(session), INACTIVE_TEXT)
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

  sentinel.unlock(agentOf(session), INACTIVE_TEXT)

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

  sentinel.unlock(agentOf(session), INACTIVE_TEXT)

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

  const result = sentinel.unlock(agentOf(session), INACTIVE_TEXT)

  assert.equal(textOf(result), '最終応答から 5 分です。キャッシュは有効なのでそのまま送信できます')
})

test('unlock: 応答が無いセッションは no-response の文面を返す', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  const result = sentinel.unlock(agentOf(session), INACTIVE_TEXT)

  assert.equal(textOf(result), 'このセッションはまだモデル応答がありません')
})

test('ブロック時の info ログにセッション id と経過分数が含まれる', async () => {
  const log = makeLogger()
  const { session } = sessionWith('session-xyz', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  await sentinel.onPreStep(payload(session), nextSpy().next)

  someMessage(log.info, (m) => m.includes('session-xyz') && m.includes('61 分'))
})

test('isActive が false なら失効していても next を呼ぶ', async () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW, () => false)
  const pass = nextSpy()

  const result = await sentinel.onPreStep(payload(session), pass.next)

  assert.equal(result, pass.decision)
  assert.equal(pass.calls(), 1)
  assert.deepEqual(log.info, [])
})

test('unlock: isActive が false なら inactiveText をそのまま返し、許可を記録しない', async () => {
  let active = false
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW, () => active)

  const result = sentinel.unlock(agentOf(session), INACTIVE_TEXT)

  assert.deepEqual(result, { kind: 'success', text: INACTIVE_TEXT })

  // 無効中に許可は記録されていないので、有効化しても失効したままならブロックされる。
  active = true
  const pass = nextSpy()
  assert.deepEqual(await sentinel.onPreStep(payload(session), pass.next), { kind: 'reject' })
  assert.equal(pass.calls(), 0)
})

test('idleMinutesOf: 応答が無ければ undefined', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  assert.equal(sentinel.idleMinutesOf(session), undefined)
})

test('idleMinutesOf: 経過分は切り捨てる', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE - 59_999 }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  assert.equal(sentinel.idleMinutesOf(session), 61)
})

test('idleMinutesOf: 時計巻き戻り(lastResponseAt > now)は 0', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW + 5 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, () => NOW)

  assert.equal(sentinel.idleMinutesOf(session), 0)
})
