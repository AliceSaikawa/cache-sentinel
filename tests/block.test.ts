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
import { buildBlockNotice, NOTICE_TEXT_LIMIT } from '../src/notice.ts'

const MINUTE = 60_000
const NOW = 1_700_000_000_000

/** answer-guard のリマインダーのモデル向け本文と、表示用の summary (実物は spike.md「N2」)。 */
const REMINDER_TEXT =
  'Your previous assistant message contained no visible text: it was about to end the turn with only reasoning, so the reader was shown no answer. Do not repeat tool calls or redo the work. Restate the answer you already reached as ordinary text, outside any reasoning block, now.'
const REMINDER_SUMMARY = '本文なしの応答を検知したため、再出力を要求しました'

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

/** answer-guard のリマインダー相当の入力 (#29。rdsh-answer-guard の createReminder と同じ形)。 */
function noticeMessage(text: string, summary: string, kind = 'rdsh-answer-guard'): StepMessage {
  // DSH の MessageSource は form なども持つ。境界の型に無いフィールドが混ざっていても読めることを兼ねる。
  const source = { kind, form: 'notice', summary }
  return { content: [{ type: 'text', text }], source }
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

/**
 * `agent/status` が idle に戻ったことを sentinel に伝える(#27)。
 * 実機では blocked の `turn/end` の後に必ず来るので、通知はこの時点で書かれる。
 */
function goIdle(sentinel: ReturnType<typeof createSentinel>, session: SessionLike): void {
  sentinel.onAgentStatus('idle', session)
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
  // #27: 拒否した時点では書かない (turn の中に入ってしまうため)。
  assert.equal(appends.length, 0)

  goIdle(sentinel, session)

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

test('D-append2: 文面が変われば、間隔内でも commandId を変えて追加する', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, nextSpy().next)
  goIdle(sentinel, session)
  clock.now = NOW + MINUTE
  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('別の入力')] }, nextSpy().next)
  goIdle(sentinel, session)

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

test('D-append6: 同じ文面の連打では通知を積み重ねず、他の文面なら追加する', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)
  const messages: StepMessage[] = [textMessage('入力')]

  for (let i = 0; i < 3; i++) {
    const pass = nextSpy()
    const result = await sentinel.onPreStep({ ...payload(session), messages }, pass.next)
    // 通知を抑えても拒否は毎回行う。
    assert.deepEqual(result, { kind: 'reject' }, `${i + 1} 回目`)
    assert.equal(pass.calls(), 0, `${i + 1} 回目`)
    goIdle(sentinel, session)
  }

  assert.equal(appends.length, 2)

  await sentinel.onPreStep(
    { ...payload(session), messages: [textMessage('別の入力')] },
    nextSpy().next,
  )
  goIdle(sentinel, session)
  assert.equal(appends.length, 4)
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

  // 書き出すのは idle のとき。ここで失敗しても落ちず、warn を出す。
  goIdle(sentinel, session)
  someMessage(
    log.warn,
    (m) => m.includes('ブロック通知を会話に追加できませんでした') && m.includes('s1') && m.includes('disk full'),
  )
})

// --- #30: 連続通知の抑制 (spec-ui §D) ---

/** 失効したセッションで、指定した文面の入力を 1 回送り、idle まで進める (#27)。 */
async function blockOnce(session: SessionLike, text: string) {
  const sentinel = SENTINELS.get(session)
  assert.ok(sentinel !== undefined, 'createSentinel を通した session を渡してください')
  const pass = nextSpy()
  const result = await sentinel.onPreStep({ ...payload(session), messages: [textMessage(text)] }, pass.next)
  // 実機では reject の後に idle が来る。通知はそこで書かれる。
  goIdle(sentinel, session)
  return { result, pass }
}

/** blockOnce で使う sentinel を session から引くための控え。 */
const SENTINELS = new WeakMap<SessionLike, ReturnType<typeof createSentinel>>()

/** 失効したセッションと、そこに紐づく sentinel を作る(時計は呼び出し側が進める)。 */
function expiredSession(id: string, clock: { now: number }) {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith(id, () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)
  SENTINELS.set(session, sentinel)
  return { session, appends, log, sentinel }
}

test('D4: 同じ文面の連続拒否では通知が 1 件だけになり、抑えたことを info ログに出す', async () => {
  const clock = { now: NOW }
  const { session, appends, log } = expiredSession('s1', clock)

  const first = await blockOnce(session, '同じ入力')
  assert.deepEqual(first.result, { kind: 'reject' })
  assert.equal(first.pass.calls(), 0)
  assert.equal(appends.length, 2)

  clock.now = NOW + MINUTE
  const second = await blockOnce(session, '同じ入力')
  assert.deepEqual(second.result, { kind: 'reject' })
  assert.equal(second.pass.calls(), 0)
  assert.equal(appends.length, 2)

  // ブロックのログは抑えたときも毎回出る(spec.md §5)。通知だけを抑える。
  assert.deepEqual(log.info, [
    'ブロックしました: s1 (最終応答から 61 分, turn 1 step 1)。/unlock で次の送信を許可できます',
    'ブロックしました: s1 (最終応答から 62 分, turn 1 step 1)。/unlock で次の送信を許可できます',
    '同じ文面のブロック通知を抑えました: s1 (最終応答から 62 分)',
  ])
})

test('D4: 10 分経過すると同じ文面でも再通知する', async () => {
  const clock = { now: NOW }
  const { session, appends } = expiredSession('s1', clock)

  await blockOnce(session, '同じ入力')
  assert.equal(appends.length, 2)

  // 9 分 59 秒 999 では抑える。
  clock.now = NOW + 10 * MINUTE - 1
  await blockOnce(session, '同じ入力')
  assert.equal(appends.length, 2)

  clock.now = NOW + 10 * MINUTE
  await blockOnce(session, '同じ入力')
  assert.equal(appends.length, 4)
})

test('D4: 文面が変われば間隔内でもすぐ通知する', async () => {
  const clock = { now: NOW }
  const { session, appends } = expiredSession('s1', clock)

  await blockOnce(session, 'A')
  clock.now = NOW + MINUTE
  await blockOnce(session, 'B')

  assert.equal(appends.length, 4)
  const first = appendAt(appends, 1).data as CommandDoneData
  const second = appendAt(appends, 3).data as CommandDoneData
  assert.match(first.text, /\nA$/)
  assert.match(second.text, /\nB$/)
})

test('D4: A → B → A で A が再び通知される', async () => {
  const clock = { now: NOW }
  const { session, appends } = expiredSession('s1', clock)

  await blockOnce(session, 'A')
  clock.now = NOW + MINUTE
  await blockOnce(session, 'B')
  clock.now = NOW + 2 * MINUTE
  await blockOnce(session, 'A')

  assert.equal(appends.length, 6)
  const third = appendAt(appends, 5).data as CommandDoneData
  assert.match(third.text, /\nA$/)
})

test('D4: セッションが違えば独立して通知する', async () => {
  const clock = { now: NOW }
  const first = expiredSession('s1', clock)
  const second = expiredSession('s2', clock)

  await blockOnce(first.session, '同じ入力')
  clock.now = NOW + MINUTE
  await blockOnce(second.session, '同じ入力')

  assert.equal(first.appends.length, 2)
  assert.equal(second.appends.length, 2)
})

test('D4: 破棄入力を切り詰めた後の文面で比較する', async () => {
  const clock = { now: NOW }
  const { session, appends } = expiredSession('s1', clock)

  // 2000 文字まではそのまま、超えた分は省略記号になり文面が同じになる。
  const head = 'あ'.repeat(NOTICE_TEXT_LIMIT)
  await blockOnce(session, `${head}1`)
  clock.now = NOW + MINUTE
  await blockOnce(session, `${head}2`)

  assert.equal(appends.length, 2)
})

test('D4: 抑えたときは warn を出さず、append も呼ばない', async () => {
  const clock = { now: NOW }
  const { session, appends, log } = expiredSession('s1', clock)

  await blockOnce(session, '同じ入力')
  clock.now = NOW + MINUTE
  await blockOnce(session, '同じ入力')

  assert.deepEqual(log.warn, [])
  assert.equal(appends.length, 2)
})

test('D4: 会話への追加に失敗した通知は出したことにせず、次の同じ文面で通知する', async () => {
  const clock = { now: NOW }
  const log = makeLogger()
  const appends: Array<{ type: string; data: unknown }> = []
  const failing = { count: 1 }
  const { session: base } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const session: SessionLike = {
    ...base,
    append(type: string, data: unknown) {
      if (failing.count > 0) {
        failing.count -= 1
        throw new Error('disk full')
      }
      appends.push({ type, data })
    },
  }
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)
  const send = async () => {
    const result = await sentinel.onPreStep({ ...payload(session), messages: [textMessage('同じ入力')] }, nextSpy().next)
    goIdle(sentinel, session)
    return result
  }

  assert.deepEqual(await send(), { kind: 'reject' })
  assert.equal(appends.length, 0)

  clock.now = NOW + MINUTE
  assert.deepEqual(await send(), { kind: 'reject' })
  assert.equal(appends.length, 2)
  assert.equal(appendAt(appends, 0).type, 'command/run')
  assert.ok(!log.info.some((m) => m.includes('抑えました')), log.info.join('\n'))
})

/** idleMinutes = 5 の失効したセッション。最終応答は NOW - 6 分。 */
function shortIdleSession(id: string, clock: { now: number }) {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith(id, () => [{ type: 'step/end', time: NOW - 6 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG, idleMinutes: 5 }, log.log, 'ja', () => clock.now)
  /** 1 回送り、idle まで進める(#27。通知は idle で書かれる)。 */
  const send = async (text: string, kind = 'user') => {
    const result = await sentinel.onPreStep({ ...payload(session), messages: [textMessage(text, kind)] }, nextSpy().next)
    goIdle(sentinel, session)
    return result
  }
  return { session, appends, sentinel, send }
}

test('D4: /unlock で送信が通った後は、10 分以内でも同じ文面を通知する', async () => {
  const clock = { now: NOW }
  const { session, appends, sentinel, send } = shortIdleSession('s1', clock)

  assert.deepEqual(await send('A'), { kind: 'reject' })
  assert.equal(appends.length, 2)

  // /unlock → 送信が通って応答 → 6 分後にまた失効。最初の通知から 8 分。
  clock.now = NOW + MINUTE
  sentinel.unlock(agentOf(session), INACTIVE_TEXT)
  assert.deepEqual(await send('別の入力'), { kind: 'enter' })
  sentinel.onSessionEvent(session, { type: 'step/end', time: NOW + 2 * MINUTE })
  clock.now = NOW + 8 * MINUTE

  assert.deepEqual(await send('A'), { kind: 'reject' })
  assert.equal(appends.length, 4)
  const notice = appendAt(appends, 3).data as CommandDoneData
  assert.match(notice.text, /^送信を止めました\(最終応答から 6 分。/)
})

test('D4: 失効していない送信が通った後は、10 分以内でも同じ文面を通知する', async () => {
  const clock = { now: NOW }
  const { session, appends, sentinel, send } = shortIdleSession('s1', clock)

  await send('A')
  // 別の経路(ジョブ完了など)の応答で失効が解け、その間にユーザーの送信が通る。
  clock.now = NOW + MINUTE
  sentinel.onSessionEvent(session, { type: 'step/end', time: NOW + MINUTE })
  clock.now = NOW + 2 * MINUTE
  assert.deepEqual(await send('別の入力'), { kind: 'enter' })
  sentinel.onSessionEvent(session, { type: 'step/end', time: NOW + 3 * MINUTE })

  clock.now = NOW + 9 * MINUTE
  assert.deepEqual(await send('A'), { kind: 'reject' })
  assert.equal(appends.length, 4)
})

test('D4: ユーザーの送信ではないステップが通っても、同じ文面の通知は抑えたまま', async () => {
  const clock = { now: NOW }
  const { appends, send } = shortIdleSession('s1', clock)

  await send('A')
  // 失効中のジョブ完了の入力(other-input)は通るが、ユーザーの送信ではない。
  clock.now = NOW + MINUTE
  assert.deepEqual(await send('job done', 'tool-jobs'), { kind: 'enter' })

  clock.now = NOW + 2 * MINUTE
  assert.deepEqual(await send('A'), { kind: 'reject' })
  assert.equal(appends.length, 2)
})

test('D4: dryRun では抑制の判定をせず、通知もログも出さない', async () => {
  const clock = { now: NOW }
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG, dryRun: true }, log.log, 'ja', () => clock.now)

  for (let i = 0; i < 2; i++) {
    const pass = nextSpy()
    assert.equal(await sentinel.onPreStep({ ...payload(session), messages: [textMessage('同じ入力')] }, pass.next), pass.decision)
    assert.equal(pass.calls(), 1)
  }

  assert.equal(appends.length, 0)
  assert.ok(!log.info.some((m) => m.includes('抑えました')), log.info.join('\n'))
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
  goIdle(sentinel, session)

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
  // #27: 通知は idle に戻ったときに書かれる。拒否そのものはここで終わっている。
  goIdle(sentinel, session)
  return { result, pass, appends, log }
}

test('B10: ターンの 2 ステップ目以降は、直前の step/end から失効していても通し、通知しない', async () => {
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
  // 他の入力は summary を持つので summary を載せる(#29。モデル向けの本文は出さない)。
  const messages = [noticeMessage(REMINDER_TEXT, REMINDER_SUMMARY), textMessage('続けて')]
  const { result, pass, appends } = await preStepOnExpired({ step: 1, messages })

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  const done = appendAt(appends, 1).data as CommandDoneData
  assert.equal(done.text, buildBlockNotice({ idleMinutes: 61, messages }, 'ja'))
  assert.match(done.text, /本文なしの応答を検知したため、再出力を要求しました\n\n続けて$/)
  assert.ok(!done.text.includes(REMINDER_TEXT), done.text)
})

// --- #29: 破棄された入力の出どころごとの文面 (spec-ui §D) ---

test('D5: answer-guard のリマインダーは summary を載せ、モデル向けの本文を出さない', async () => {
  const messages = [textMessage('続けて'), noticeMessage(REMINDER_TEXT, REMINDER_SUMMARY)]
  const { result, pass, appends } = await preStepOnExpired({ step: 1, messages })

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  const done = appendAt(appends, 1).data as CommandDoneData
  assert.equal(done.text, buildBlockNotice({ idleMinutes: 61, messages }, 'ja'))
  assert.match(done.text, /破棄された入力:\n続けて\n\n本文なしの応答を検知したため、再出力を要求しました$/)
  assert.ok(!done.text.includes('Your previous assistant message'), done.text)
})

test('D5: summary が無い他の入力は出どころ名だけを 1 行にする', async () => {
  const messages = [textMessage('続けて'), textMessage('自動の入力', 'tool-jobs')]
  const { result, pass, appends } = await preStepOnExpired({ step: 1, messages })

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  const done = appendAt(appends, 1).data as CommandDoneData
  assert.equal(done.text, buildBlockNotice({ idleMinutes: 61, messages }, 'ja'))
  assert.match(done.text, /破棄された入力:\n続けて\n\n\(tool-jobs からの入力\)$/)
  assert.ok(!done.text.includes('自動の入力'), done.text)
})

test('#29: 出どころごとの文面は、前回と同じなら 10 分に 1 件に抑える', async () => {
  const clock = { now: NOW }
  const { session, appends } = expiredSession('s1', clock)
  const messages = [noticeMessage(REMINDER_TEXT, REMINDER_SUMMARY), textMessage('続けて')]

  const first = nextSpy()
  await SENTINELS.get(session)!.onPreStep({ ...payload(session), messages }, first.next)
  goIdle(SENTINELS.get(session)!, session)
  assert.equal(appends.length, 2)

  // 同じ入力の連打は抑える。
  clock.now = NOW + MINUTE
  const second = nextSpy()
  assert.deepEqual(
    await SENTINELS.get(session)!.onPreStep({ ...payload(session), messages }, second.next),
    { kind: 'reject' },
  )
  goIdle(SENTINELS.get(session)!, session)
  assert.equal(appends.length, 2)

  // 出どころの summary が変われば文面が変わるので、間隔内でも通知する。
  clock.now = NOW + 2 * MINUTE
  const changed = [noticeMessage(REMINDER_TEXT, '別の説明'), textMessage('続けて')]
  await SENTINELS.get(session)!.onPreStep({ ...payload(session), messages: changed }, nextSpy().next)
  goIdle(SENTINELS.get(session)!, session)
  assert.equal(appends.length, 4)
})

test('#7: source の無いメッセージがあっても、同じステップのユーザーの送信は止める', async () => {
  const noSource: StepMessage = { content: [{ type: 'text', text: '出どころ不明' }] }
  const { result, pass, log } = await preStepOnExpired({ step: 1, messages: [noSource, textMessage('続けて')] })

  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  assert.deepEqual(log.warn, [])
})

test('#7: source の無いメッセージだけの最初のステップは、ユーザーの送信ではないので通す', async () => {
  const noSource: StepMessage = { content: [{ type: 'text', text: '出どころ不明' }] }
  const { result, pass, log } = await preStepOnExpired({ step: 1, messages: [noSource] })

  assert.equal(result, pass.decision)
  assert.equal(pass.calls(), 1)
  assert.deepEqual(log.warn, [])
  assert.deepEqual(log.info, [
    '失効していますがユーザーの送信ではないので通しました: s1 (turn 3 step 1, 入力: (source なし))',
  ])
})

test('B7: dryRun でも、止める対象でないステップに「ブロック対象」のログは出さない', async () => {
  const { result, pass, log } = await preStepOnExpired({ step: 2, messages: [] }, { dryRun: true })

  assert.equal(result, pass.decision)
  assert.ok(!log.info.some((m) => m.includes('dryRun')), log.info.join('\n'))
})

// --- #27: 通知を turn の外 (idle 遷移) に書く (spec-ui §D) ---

test('#27: reject の時点では書かず、idle に戻ったときに 1 回だけ書く', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, nextSpy().next)

  // 拒否した時点ではまだ書かない (turn の中に入ってしまうため)。
  assert.equal(appends.length, 0)

  goIdle(sentinel, session)

  // idle で 1 回だけ書く。turn の外に出るので折りたたみの奥に入らない。
  assert.equal(appends.length, 2)
  assert.equal(appendAt(appends, 0).type, 'command/run')
  assert.equal(appendAt(appends, 1).type, 'command/done')

  // 同じ idle 遷移がもう一度来ても (idle → idle は DSH では emit されないが)、二重には書かない。
  goIdle(sentinel, session)
  assert.equal(appends.length, 2)
})

test('#27: idle が来ないまま running が来たら、前のターンの保留を捨てて info ログを出す', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('古い入力')] }, nextSpy().next)

  // 次のドライバの開始。保留は前のターンのものなので書かずに捨てる。
  sentinel.onAgentStatus('running', session)
  assert.equal(appends.length, 0)
  assert.deepEqual(log.info.slice(-1), [
    '前のターンで保留したブロック通知を捨てました(idle が来ないまま次のターンが始まったため): s1',
  ])

  // そのターンが通って idle に戻っても、古い通知は出ない。
  sentinel.onAgentStatus('idle', session)
  assert.equal(appends.length, 0)
})

test('#27: running の後に拒否した通知は、続く idle で書く', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  // 実機の順: running(ドライバ開始)→ pre-step で拒否 → idle。
  sentinel.onAgentStatus('running', session)
  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, nextSpy().next)
  sentinel.onAgentStatus('idle', session)

  assert.deepEqual(
    appends.map((a) => a.type),
    ['command/run', 'command/done'],
  )
  assert.ok(!log.info.some((m) => m.includes('捨てました')), log.info.join('\n'))
})

test('#27: 保留を捨てた後の同じ文面は、抑えずに通知する(書けなかった通知は出したことにしない)', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('同じ入力')] }, nextSpy().next)
  sentinel.onAgentStatus('running', session)

  clock.now = NOW + MINUTE
  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('同じ入力')] }, nextSpy().next)
  sentinel.onAgentStatus('idle', session)

  assert.equal(appends.length, 2)
})

test('#27: 別セッションの idle では書かず、そのセッションの保留は残る', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const a = appendingSessionWith('a', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const b = appendingSessionWith('b', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  await sentinel.onPreStep({ ...payload(a.session), messages: [textMessage('A の入力')] }, nextSpy().next)

  // 別セッション (b) の idle では a の保留は書かれない。
  goIdle(sentinel, b.session)
  assert.equal(a.appends.length, 0)
  assert.equal(b.appends.length, 0)

  // 正しいセッション (a) の idle で書かれる。
  goIdle(sentinel, a.session)
  assert.equal(a.appends.length, 2)
  assert.equal(b.appends.length, 0)

  const done = appendAt(a.appends, 1).data as CommandDoneData
  assert.match(done.text, /A の入力$/)
})

test('#27: 保留はセッションごとに最新の 1 件だけ (古い通知は捨てる)', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  // 文面の違う拒否を 2 回 (idle を挟まない)。1 件目の保留は捨てられる。
  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('古い入力')] }, nextSpy().next)
  clock.now = NOW + MINUTE
  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('新しい入力')] }, nextSpy().next)

  assert.equal(appends.length, 0)

  goIdle(sentinel, session)

  // 書かれるのは最新の 1 件だけ。古い通知は遅れて積み増されない。
  assert.equal(appends.length, 2)
  const done = appendAt(appends, 1).data as CommandDoneData
  assert.match(done.text, /新しい入力$/)
  assert.ok(!done.text.includes('古い入力'), done.text)
})

test('#27: 抑制 (#30) で抑えた拒否は保留を作らない (idle でも書かれない)', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('同じ入力')] }, nextSpy().next)
  goIdle(sentinel, session)
  assert.equal(appends.length, 2)

  // 2 回目は同じ文面なので抑制され、保留も作られない。
  clock.now = NOW + MINUTE
  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('同じ入力')] }, nextSpy().next)
  goIdle(sentinel, session)

  assert.equal(appends.length, 2)
  someMessage(log.info, (m) => m.includes('同じ文面のブロック通知を抑えました'))
})

test('#27: 保留があるまま idle が来なければ書かれない (書き出しは idle が引き金)', async () => {
  const log = makeLogger()
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, nextSpy().next)

  // session/event を観測しても書かれない (turn の中に書かないことの確認)。
  sentinel.onSessionEvent(session, { type: 'turn/end', time: NOW })
  assert.equal(appends.length, 0)
})

test('#27: Session に append が無ければ保留を作らず、running でも idle でも何もしない', async () => {
  const log = makeLogger()
  const { session } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, nextSpy().next)

  goIdle(sentinel, session)
  sentinel.onAgentStatus('running', session)
  assert.deepEqual(log.warn, [])
  assert.deepEqual(log.info, ['ブロックしました: s1 (最終応答から 61 分, turn 1 step 1)。/unlock で次の送信を許可できます'])
})

test('#27: append が失敗しても落ちず、保留は残らない (idle の後始末)', async () => {
  const log = makeLogger()
  const { session: base } = sessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  let calls = 0
  const session: SessionLike = {
    ...base,
    append() {
      calls += 1
      throw new Error('disk full')
    },
  }
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => NOW)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, nextSpy().next)
  goIdle(sentinel, session)

  someMessage(log.warn, (m) => m.includes('disk full'))
  const afterFailure = calls

  // 失敗した保留は残らないので、もう一度 idle が来ても再試行しない。
  goIdle(sentinel, session)
  assert.equal(calls, afterFailure)
})

test('#27: 文面は拒否した時点の言語と経過分で作る (idle で作り直さない)', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('en-session', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'en', () => clock.now)
  const messages: StepMessage[] = [textMessage('draft')]

  await sentinel.onPreStep({ ...payload(session), messages }, nextSpy().next)

  // idle が来る前に時計が進んでも、文面の経過分は拒否した時点 (61 分) のまま。
  clock.now = NOW + 5 * MINUTE
  goIdle(sentinel, session)

  const done = appendAt(appends, 1).data as CommandDoneData
  assert.equal(done.text, buildBlockNotice({ idleMinutes: 61, messages }, 'en'))
  assert.ok(done.text.startsWith('Send blocked ('), done.text)
})

test('#27: 同じセッションで idle を挟んで別の文面を送れば、それぞれ書かれる', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)

  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('1 回目')] }, nextSpy().next)
  goIdle(sentinel, session)
  clock.now = NOW + MINUTE
  await sentinel.onPreStep({ ...payload(session), messages: [textMessage('2 回目')] }, nextSpy().next)
  goIdle(sentinel, session)

  assert.equal(appends.length, 4)
  assert.match((appendAt(appends, 1).data as CommandDoneData).text, /1 回目$/)
  assert.match((appendAt(appends, 3).data as CommandDoneData).text, /2 回目$/)
})

test('#27: reject は idle を待たずその場で返る (拒否のタイミングは変えない)', async () => {
  const log = makeLogger()
  const clock = { now: NOW }
  const { session, appends } = appendingSessionWith('s1', () => [{ type: 'step/end', time: NOW - 61 * MINUTE }])
  const sentinel = createSentinel({ ...CONFIG }, log.log, 'ja', () => clock.now)
  const pass = nextSpy()

  const result = await sentinel.onPreStep({ ...payload(session), messages: [textMessage('入力')] }, pass.next)

  // 拒否そのものは即座に返り、通知の書き出しを待たない。
  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(pass.calls(), 0)
  assert.equal(appends.length, 0)
})
