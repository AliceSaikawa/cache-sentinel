import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBlockNotice,
  NOTICE_TEXT_LIMIT,
  NoticeThrottle,
  type NoticeMessage,
} from '../src/notice.ts'

/** 1 行目・2 行目 (常に同じ) の前置き。 */
const HEAD = [
  '送信を止めました(最終応答から 75 分。キャッシュが切れている可能性が高いため)。',
  '/unlock で次の 1 回を許可できます。',
].join('\n')

test('buildBlockNotice: 入力がなければ前置き 2 行だけ・末尾に改行なし', () => {
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages: [] }), HEAD)
})

test('buildBlockNotice: idleMinutes が 1 行目に入る', () => {
  const text = buildBlockNotice({ idleMinutes: 3, messages: [] })
  assert.equal(
    text,
    [
      '送信を止めました(最終応答から 3 分。キャッシュが切れている可能性が高いため)。',
      '/unlock で次の 1 回を許可できます。',
    ].join('\n'),
  )
})

test('buildBlockNotice: text ブロック 1 件で「破棄された入力」を出す', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: 'こんにちは' }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\nこんにちは`)
})

test('buildBlockNotice: 複数メッセージは空行 1 つで区切る', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 'A' }] },
    { content: [{ type: 'text', text: 'B' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\nA\n\nB`)
})

test('buildBlockNotice: 同じメッセージ内の text は区切りなしで連結して 1 件', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\nAB`)
})

test('buildBlockNotice: 空文字だけのメッセージは「破棄された入力」に出さない', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: '' }] },
    { content: [{ type: 'text', text: 'X' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\nX`)
})

test('buildBlockNotice: text が空文字だけなら節を出さない', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: '' }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), HEAD)
})

test('buildBlockNotice: text が文字列でない text ブロックは件に数えず添付にも数えない', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 123 }, { type: 'text' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), HEAD)
})

test('buildBlockNotice: 省略の境界ちょうど (2000 文字) は省略しない', () => {
  const body = 'あ'.repeat(NOTICE_TEXT_LIMIT)
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: body }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\n${body}`)
})

test('buildBlockNotice: 1 文字超 (2001 文字) は先頭 2000 文字 + 省略記号', () => {
  const body = 'あ'.repeat(NOTICE_TEXT_LIMIT + 1)
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: body }] }]
  const expected = `${'あ'.repeat(NOTICE_TEXT_LIMIT)}…(以下省略)`
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\n${expected}`)
})

test('buildBlockNotice: 連結後の長さで省略を判定する (境界ちょうど)', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 'あ'.repeat(NOTICE_TEXT_LIMIT - 1) }, { type: 'text', text: 'い' }] },
  ]
  const expected = `${'あ'.repeat(NOTICE_TEXT_LIMIT - 1)}い`
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\n${expected}`)
})

test('buildBlockNotice: text 以外のブロック数を数えて添付の行を最後に出す', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'image' }, { type: 'text', text: 'hi' }, { type: 'file' }] },
  ]
  assert.equal(
    buildBlockNotice({ idleMinutes: 75, messages }),
    `${HEAD}\n破棄された入力:\nhi\n(画像などテキスト以外の添付 2 件も破棄されました)`,
  )
})

test('buildBlockNotice: テキストがなく添付だけなら添付の行だけを足す', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'image' }] }]
  assert.equal(
    buildBlockNotice({ idleMinutes: 75, messages }),
    `${HEAD}\n(画像などテキスト以外の添付 1 件も破棄されました)`,
  )
})

test('buildBlockNotice: 改行を含む text はそのまま載せる', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: '1 行目\n2 行目' }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }), `${HEAD}\n破棄された入力:\n1 行目\n2 行目`)
})

test('NoticeThrottle: 初回は入力 0 件でも true', () => {
  const throttle = new NoticeThrottle(600_000)
  assert.equal(throttle.shouldNotify('s1', 1000, false), true)
})

test('NoticeThrottle: 入力 0 件は intervalMs 未満なら false、ちょうどで true', () => {
  const throttle = new NoticeThrottle(600_000)
  assert.equal(throttle.shouldNotify('s1', 0, false), true)
  assert.equal(throttle.shouldNotify('s1', 599_999, false), false)
  assert.equal(throttle.shouldNotify('s1', 599_999, false), false)
  assert.equal(throttle.shouldNotify('s1', 600_000, false), true)
})

test('NoticeThrottle: hasMessages が真なら常に true で記録時刻も更新する', () => {
  const throttle = new NoticeThrottle(600_000)
  assert.equal(throttle.shouldNotify('s1', 0, true), true)
  assert.equal(throttle.shouldNotify('s1', 1, true), true)
  // 直前の通知 (now=1) から intervalMs 未満なので false。
  assert.equal(throttle.shouldNotify('s1', 599_999, false), false)
  assert.equal(throttle.shouldNotify('s1', 600_001, false), true)
})

test('NoticeThrottle: hasMessages が真なら intervalMs 内でも true (毎回通知)', () => {
  const throttle = new NoticeThrottle(600_000)
  assert.equal(throttle.shouldNotify('s1', 0, false), true)
  assert.equal(throttle.shouldNotify('s1', 1, true), true)
})

test('NoticeThrottle: セッションごとに独立して記録する', () => {
  const throttle = new NoticeThrottle(600_000)
  assert.equal(throttle.shouldNotify('s1', 0, false), true)
  assert.equal(throttle.shouldNotify('s2', 1, false), true)
  assert.equal(throttle.shouldNotify('s1', 2, false), false)
  assert.equal(throttle.shouldNotify('s2', 3, false), false)
})

test('NoticeThrottle: false を返しても記録時刻は更新しない', () => {
  const throttle = new NoticeThrottle(600_000)
  assert.equal(throttle.shouldNotify('s1', 0, false), true)
  assert.equal(throttle.shouldNotify('s1', 300_000, false), false)
  // 記録は 0 のままなので、0 からちょうど intervalMs で true。
  assert.equal(throttle.shouldNotify('s1', 600_000, false), true)
})
