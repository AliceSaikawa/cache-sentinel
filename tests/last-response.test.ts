import assert from 'node:assert/strict'
import test from 'node:test'
import { findLastResponseAt, LastResponseTracker, resolveLastResponseAt, type TimedEvent } from '../src/last-response.ts'

test('findLastResponseAt は末尾から走査して最後の step/end を返す', () => {
  const events: TimedEvent[] = [
    { type: 'step/end', time: 100 },
    { type: 'user/message', time: 200 },
    { type: 'step/end', time: 300 },
  ]
  assert.equal(findLastResponseAt(events), 300)
})

test('findLastResponseAt は step/end がなければ undefined', () => {
  assert.equal(findLastResponseAt([{ type: 'user/message', time: 1 }]), undefined)
  assert.equal(findLastResponseAt([]), undefined)
})

test('findLastResponseAt は time が有限数でない step/end を飛ばして続ける', () => {
  const events: TimedEvent[] = [
    { type: 'step/end', time: 100 },
    { type: 'step/end', time: Number.NaN },
    { type: 'step/end', time: Number.POSITIVE_INFINITY },
  ]
  assert.equal(findLastResponseAt(events), 100)
})

test('resolveLastResponseAt は ownEvents が無ければ全イベントから探す(従来どおり)', () => {
  const inherited: TimedEvent[] = [
    { type: 'step/end', time: 100 },
    { type: 'step/end', time: 300 },
  ]
  assert.equal(resolveLastResponseAt(inherited, {}), 300)
  assert.equal(resolveLastResponseAt([{ type: 'user/message', time: 1 }], {}), undefined)
})

test('B13: resolveLastResponseAt は ownEvents があれば引き継いだ部分の step/end を使わない', () => {
  // 引き継いだ最後の step/end は古い(61 分前)。子自身の応答はまだ無い。
  const inherited: TimedEvent[] = [{ type: 'step/end', time: 100 }]
  assert.equal(resolveLastResponseAt(inherited, { ownEvents: [], createdAt: 500 }), 500)
})

test('resolveLastResponseAt は子自身の step/end と createdAt の遅い方を採る', () => {
  const inherited: TimedEvent[] = [{ type: 'step/end', time: 100 }]

  // 子自身の応答(400)が作成時刻(300)より新しい → 応答の時刻。
  assert.equal(resolveLastResponseAt(inherited, { ownEvents: [{ type: 'step/end', time: 400 }], createdAt: 300 }), 400)

  // 子自身の応答(200)より作成時刻(300)が新しい → 作成時刻。
  assert.equal(resolveLastResponseAt(inherited, { ownEvents: [{ type: 'step/end', time: 200 }], createdAt: 300 }), 300)
})

test('resolveLastResponseAt は createdAt が無ければ子自身の step/end だけを使う', () => {
  const inherited: TimedEvent[] = [{ type: 'step/end', time: 100 }]
  assert.equal(resolveLastResponseAt(inherited, { ownEvents: [{ type: 'step/end', time: 400 }] }), 400)
  assert.equal(resolveLastResponseAt(inherited, { ownEvents: [] }), undefined)
})

test('get はキャッシュ済みなら load を呼び直さない', () => {
  let calls = 0
  const tracker = new LastResponseTracker((sessionId) => {
    calls++
    assert.equal(sessionId, 's1')
    return { events: [{ type: 'step/end', time: 500 }], view: {} }
  })
  assert.equal(tracker.get('s1'), 500)
  assert.equal(tracker.get('s1'), 500)
  assert.equal(calls, 1)
})

test('get は step/end のないイベント列の結果 undefined もキャッシュする', () => {
  let calls = 0
  const tracker = new LastResponseTracker(() => {
    calls++
    return { events: [{ type: 'user/message', time: 1 }], view: {} }
  })
  assert.equal(tracker.get('s1'), undefined)
  assert.equal(tracker.get('s1'), undefined)
  assert.equal(calls, 1)
})

test('キャッシュはセッション id ごとに分かれる', () => {
  const times: Record<string, number> = { s1: 11, s2: 22 }
  const tracker = new LastResponseTracker((sessionId) => ({ events: [{ type: 'step/end', time: times[sessionId]! }], view: {} }))
  assert.equal(tracker.get('s1'), 11)
  assert.equal(tracker.get('s2'), 22)
})

test('observe は新しい step/end で更新し、古い時刻では上書きしない', () => {
  const tracker = new LastResponseTracker(() => ({ events: [{ type: 'step/end', time: 100 }], view: {} }))
  assert.equal(tracker.get('s1'), 100)
  tracker.observe('s1', { type: 'step/end', time: 200 })
  assert.equal(tracker.get('s1'), 200)
  tracker.observe('s1', { type: 'step/end', time: 150 })
  assert.equal(tracker.get('s1'), 200)
})

test('observe は未登録のセッションでも登録し、以後 load しない', () => {
  let calls = 0
  const tracker = new LastResponseTracker(() => {
    calls++
    return undefined
  })
  tracker.observe('s1', { type: 'step/end', time: 42 })
  assert.equal(tracker.get('s1'), 42)
  assert.equal(calls, 0)
})

test('observe は step/end 以外と不正な time を無視する', () => {
  let calls = 0
  const tracker = new LastResponseTracker(() => {
    calls++
    return undefined
  })
  tracker.observe('s1', { type: 'user/message', time: 10 })
  tracker.observe('s1', { type: 'step/end', time: Number.NaN })
  tracker.observe('s1', { type: 'step/end', time: Number.POSITIVE_INFINITY })
  assert.equal(tracker.get('s1'), undefined)
  assert.equal(calls, 1)
})

test('load が undefined を返したら undefined を返しキャッシュしない', () => {
  let calls = 0
  const tracker = new LastResponseTracker(() => {
    calls++
    return undefined
  })
  assert.equal(tracker.get('s1'), undefined)
  assert.equal(tracker.get('s1'), undefined)
  assert.equal(calls, 2)
})

test('load の例外はそのまま伝播しキャッシュしない', () => {
  let calls = 0
  const tracker = new LastResponseTracker(() => {
    calls++
    throw new Error('読み取り失敗')
  })
  assert.throws(() => tracker.get('s1'), /読み取り失敗/)
  assert.throws(() => tracker.get('s1'), /読み取り失敗/)
  assert.equal(calls, 2)
})

test('forget はキャッシュを捨て、次回の get で load を呼び直す', () => {
  let calls = 0
  const tracker = new LastResponseTracker(() => {
    calls++
    return { events: [{ type: 'step/end', time: 7 }], view: {} }
  })
  assert.equal(tracker.get('s1'), 7)
  tracker.forget('s1')
  assert.equal(tracker.get('s1'), 7)
  assert.equal(calls, 2)
})
