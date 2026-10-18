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
  type StepMessage,
} from '../src/block.ts'
import type { TimedEvent } from '../src/last-response.ts'
import type { Logger } from '../src/log.ts'
import { buildBlockNotice } from '../src/notice.ts'

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

/** テキスト 1 件だけの入力。既定はユーザーの送信。 */
function textMessage(text: string, kind = 'user'): StepMessage {
  return { content: [{ type: 'text', text }], source: { kind } }
}

/** ユーザーの送信で始まるターンの最初のステップ(止める対象)。 */
function payload(session: SessionLike, turn = 1, step = 1): PreStepPayload {
  return { agent: agentOf(session), messages: [textMessage('入力')], turn, step }
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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
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
    const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

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
  const sentinel = createSentinel({ ...CONFIG, dryRun: true }, log.log, 'ja', () => NOW)
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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  const result = sentinel.unlock(agentOf(session), INACTIVE_TEXT)

  assert.equal(textOf(result), '最終応答から 5 分です。キャッシュは有効なのでそのまま送信できます')
})

test('unlock: 応答が無いセッションは no-response の文面を返す', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  const result = sentinel.unlock(agentOf(session), INACTIVE_TEXT)

  assert.equal(textOf(result), 'このセッションはまだモデル応答がありません')
})

test('ブロック時の info ログにセッション id と経過分数が含まれる', async () => {
  const log = makeLogger()
  const { session } = sessionWith('session-xyz', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  await sentinel.onPreStep(payload(session), nextSpy().next)

  someMessage(log.info, (m) => m.includes('session-xyz') && m.includes('61 分'))
})

test('isActive が false なら失効していても next を呼ぶ', async () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW, () => false)
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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW, () => active)

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
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  assert.equal(sentinel.idleMinutesOf(session), undefined)
})

test('idleMinutesOf: 経過分は切り捨てる', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE - 59_999 }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  assert.equal(sentinel.idleMinutesOf(session), 61)
})

test('idleMinutesOf: 時計巻き戻り(lastResponseAt > now)は 0', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW + 5 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  assert.equal(sentinel.idleMinutesOf(session), 0)
})

// --- T35b: ブロック通知 (spec-ui v0.5 §D) と statusOf (§E1) ---

/** append(type, data) の呼び出しを記録する偽 Session。 */
function appendingSessionWith(id: string, events: () => readonly TimedEvent[]) {
  const appends: Array<{ type: string; data: unknown }> = []
  const { session: base, state } = sessionWith(id, events)
  const session: SessionLike = {
    ...base,
    append(type: string, data: unknown) {
      appends.push({ type, data })
    },
  }
  return { session, appends, state }
}

/** append で渡された command/run の payload。 */
interface CommandRunData {
  commandId: string
  name: string
  args: string
  source: { kind: string }
}

/** append で渡された command/done の payload。 */
interface CommandDoneData {
  commandId: string
  kind: string
  text: string
}

/** 記録した append の i 番目を取り出す。 */
function appendAt(appends: ReadonlyArray<{ type: string; data: unknown }>, index: number) {
  const entry = appends[index]
  assert.ok(entry !== undefined, `append の ${index} 番目がありません(全 ${appends.length} 件)`)
  return entry
}

test('D-append1: ブロックすると command/run → command/done を追加し、文面は buildBlockNotice と一致する', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
  const messages: StepMessage[] = [textMessage('捨てられる入力')]
  const pass = nextSpy()

  const result = await sentinel.onPreStep({ ...payload(session), messages }, pass.next)

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  assert.equal(appends.length, 2)

  assert.equal(appendAt(appends, 0).type, 'command/run')
  const run = appendAt(appends, 0).data as CommandRunData
  assert.match(run.commandId, /^cache-sentinel-/)
  assert.equal(run.name, 'cache-sentinel')
  assert.equal(run.args, '')
  assert.deepEqual(run.source, { kind: 'user' })

  assert.equal(appendAt(appends, 1).type, 'command/done')
  const done = appendAt(appends, 1).data as CommandDoneData
  assert.equal(done.commandId, run.commandId)
  assert.equal(done.kind, 'error')
  assert.equal(done.text, buildBlockNotice({ idleMinutes: 61, messages }, 'ja'))
})

test('D-append2: 2 回目のブロックでは commandId が変わる', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)
  const messages: StepMessage[] = [textMessage('入力')]

  await sentinel.onPreStep({ ...payload(session), messages }, nextSpy().next)
  clock.now = NOW + MINUTE
  await sentinel.onPreStep({ ...payload(session), messages }, nextSpy().next)

  assert.equal(appends.length, 4)
  const first = appendAt(appends, 0).data as CommandRunData
  const second = appendAt(appends, 2).data as CommandRunData
  assert.match(first.commandId, /^cache-sentinel-/)
  assert.match(second.commandId, /^cache-sentinel-/)
  assert.notEqual(first.commandId, second.commandId)
})

test('D-append3: dryRun では append しない', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG, dryRun: true }, log.log, 'ja', () => NOW)
  const pass = nextSpy()

  const result = await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, pass.next)

  assert.equal(result, pass.decision)
  assert.equal(pass.calls(), 1)
  assert.equal(appends.length, 0)
})

test('D-append4: Session に append が無くても reject する', async () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
  const pass = nextSpy()

  const result = await sentinel.onPreStep(payload(session), pass.next)

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
})

test('D-append6: ブロックするたびに毎回追加する', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
  const messages: StepMessage[] = [textMessage('入力')]

  for (let i = 0; i < 3; i++) {
    await sentinel.onPreStep({ ...payload(session), messages }, nextSpy().next)
  }

  assert.equal(appends.length, 6)
})

test('D-append7: append が例外を投げても reject を返し warn を出す', async () => {
  const log = makeLogger()
  const { session: base } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const session: SessionLike = {
    ...base,
    append() {
      throw new Error('disk full')
    },
  }
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
  const pass = nextSpy()

  const result = await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, pass.next)

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  someMessage(
    log.warn,
    (m) => m.includes('ブロック通知を会話に追加できませんでした') && m.includes('s1') && m.includes('disk full'),
  )
})

test('statusOf: セッション未読込は unknown で mode をそのまま返す', () => {
  const log = makeLogger()
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  assert.deepEqual(sentinel.statusOf(undefined, 'block'), {
    mode: 'block',
    gate: true,
    state: 'unknown',
    idleMinutes: null,
    thresholdMinutes: 60,
    unlockExpiresAt: null,
    dryRun: false,
  })
})

test('statusOf: 失効セッションは stale で、mode 引数をそのまま返す', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE - 59_999 }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  const status = sentinel.statusOf(session, 'both')

  assert.equal(status.mode, 'both')
  assert.equal(status.gate, true)
  assert.equal(status.state, 'stale')
  assert.equal(status.idleMinutes, 61)
  assert.equal(status.thresholdMinutes, 60)
  assert.equal(status.unlockExpiresAt, null)
})

test('statusOf: unlock 後は unlocked で、期限は許可時刻 + unlockTtlMinutes 分', () => {
  const clock = { now: NOW }
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  sentinel.unlock(agentOf(session), INACTIVE_TEXT)

  const status = sentinel.statusOf(session, 'block')
  assert.equal(status.state, 'unlocked')
  assert.equal(status.unlockExpiresAt, NOW + 10 * MINUTE)

  // 許可の期限が切れると stale に戻る。
  clock.now = NOW + 11 * MINUTE
  assert.equal(sentinel.statusOf(session, 'block').state, 'stale')
})

test('statusOf: isActive が偽なら inactive で gate も偽', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW, () => false)

  const status = sentinel.statusOf(session, 'block')

  assert.equal(status.mode, 'block')
  assert.equal(status.gate, false)
  assert.equal(status.state, 'inactive')
  assert.equal(status.unlockExpiresAt, null)
})

// --- 表示言語 (spec-ui v0.5 §F) ---

test('D-locale: ブロック通知は createSentinel に渡した言語で書く', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'en', () => NOW)
  const messages: StepMessage[] = [textMessage('draft')]

  await sentinel.onPreStep({ ...payload(session), messages }, nextSpy().next)

  const done = appendAt(appends, 1).data as CommandDoneData
  assert.equal(done.text, buildBlockNotice({ idleMinutes: 61, messages }, 'en'))
  assert.ok(done.text.startsWith('Send blocked ('), done.text)
})

test('D-locale: /unlock の文面も createSentinel に渡した言語で書く', () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'zh-CN', () => NOW)

  assert.equal(textOf(sentinel.unlock(agentOf(session), INACTIVE_TEXT)), '本会话尚无模型响应')
})

// --- #7: 止めるステップの種類 (spec §3) ---

/** 失効したセッション(最終応答から 61 分)に、指定したステップを 1 回送る。 */
async function preStepOnExpired(
  step: { turn?: number; step: number; messages: readonly StepMessage[] },
  config: Partial<BlockSettings> = {},
) {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG, ...config }, log.log, 'ja', () => NOW)
  const pass = nextSpy()
  const result = await sentinel.onPreStep(
    { agent: agentOf(session), turn: step.turn ?? 3, step: step.step, messages: step.messages },
    pass.next,
  )
  return { result, pass, appends, log }
}

test('B10: ターンの 2 ステップ目以降(長いツール実行の後の続き)は失効していても通し、通知しない', async () => {
  const cases: ReadonlyArray<{ label: string; messages: readonly StepMessage[] }> = [
    { label: '入力 0 件', messages: [] },
    { label: 'ジョブ完了の inject', messages: [textMessage('job done', 'tool-jobs')] },
    { label: 'ユーザーの steer', messages: [textMessage('割り込み')] },
  ]
  for (const { label, messages } of cases) {
    const { result, pass, appends, log } = await preStepOnExpired({ step: 2, messages })

    assert.equal(result, pass.decision, label)
    assert.equal(pass.calls(), 1, label)
    assert.equal(appends.length, 0, label)
    assert.deepEqual(log.info, ['失効していますがターンの途中なので通しました: s1 (turn 3 step 2)'], label)
  }
})

test('B11: ユーザーの送信を含まない最初のステップ(ジョブ・サブエージェント・ゴール・リマインダー)は失効していても通す', async () => {
  const kinds = ['tool-jobs', 'subagent-settled', 'agent-message', 'goal', 'schedule'] as const
  for (const kind of kinds) {
    const { result, pass, appends, log } = await preStepOnExpired({ step: 1, messages: [textMessage('自動の入力', kind)] })

    assert.equal(result, pass.decision, kind)
    assert.equal(pass.calls(), 1, kind)
    assert.equal(appends.length, 0, kind)
    assert.deepEqual(
      log.info,
      [`失効していますがユーザーの送信ではないので通しました: s1 (turn 3 step 1, 入力: ${kind})`],
      kind,
    )
  }
})

test('B11: 最初のステップで入力が 0 件でも通す', async () => {
  const { result, pass, log } = await preStepOnExpired({ step: 1, messages: [] })

  assert.equal(result, pass.decision)
  assert.equal(pass.calls(), 1)
  assert.deepEqual(log.info, ['失効していますがユーザーの送信ではないので通しました: s1 (turn 3 step 1, 入力: なし)'])
})

test('B12: 最初のステップにユーザーの送信と他の入力が混ざっていれば止め、両方を破棄された入力として表示する', async () => {
  const messages = [textMessage('job done', 'tool-jobs'), textMessage('続けて')]
  const { result, pass, appends } = await preStepOnExpired({ step: 1, messages })

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  const done = appendAt(appends, 1).data as CommandDoneData
  assert.equal(done.text, buildBlockNotice({ idleMinutes: 61, messages }, 'ja'))
  assert.match(done.text, /job done\n\n続けて$/)
})

test('B7: dryRun でも、止める対象でないステップに「ブロック対象」のログは出さない', async () => {
  const { result, pass, log } = await preStepOnExpired({ step: 2, messages: [] }, { dryRun: true })

  assert.equal(result, pass.decision)
  assert.ok(!log.info.some((m) => m.includes('dryRun')), log.info.join('\n'))
})
