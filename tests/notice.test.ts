import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBlockNotice,
  NOTICE_TEXT_LIMIT,
  type NoticeMessage,
} from '../src/notice.ts'

/** 1 行目・2 行目 (常に同じ) の前置き。 */
const HEAD = [
  '送信を止めました(最終応答から 75 分。キャッシュが切れている可能性が高いため)。',
  '/unlock で次の 1 回を許可できます。',
].join('\n')

test('buildBlockNotice: 入力がなければ前置き 2 行だけ・末尾に改行なし', () => {
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages: [] }, 'ja'), HEAD)
})

test('buildBlockNotice: idleMinutes が 1 行目に入る', () => {
  const text = buildBlockNotice({ idleMinutes: 3, messages: [] }, 'ja')
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
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\nこんにちは`)
})

test('buildBlockNotice: 複数メッセージは空行 1 つで区切る', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 'A' }] },
    { content: [{ type: 'text', text: 'B' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\nA\n\nB`)
})

test('buildBlockNotice: 同じメッセージ内の text は区切りなしで連結して 1 件', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\nAB`)
})

test('buildBlockNotice: 空文字だけのメッセージは「破棄された入力」に出さない', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: '' }] },
    { content: [{ type: 'text', text: 'X' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\nX`)
})

test('buildBlockNotice: text が空文字だけなら節を出さない', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: '' }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), HEAD)
})

test('buildBlockNotice: text が文字列でない text ブロックは件に数えず添付にも数えない', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 123 }, { type: 'text' }] },
  ]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), HEAD)
})

test('buildBlockNotice: 省略の境界ちょうど (2000 文字) は省略しない', () => {
  const body = 'あ'.repeat(NOTICE_TEXT_LIMIT)
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: body }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\n${body}`)
})

test('buildBlockNotice: 1 文字超 (2001 文字) は先頭 2000 文字 + 省略記号', () => {
  const body = 'あ'.repeat(NOTICE_TEXT_LIMIT + 1)
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: body }] }]
  const expected = `${'あ'.repeat(NOTICE_TEXT_LIMIT)}…(以下省略)`
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\n${expected}`)
})

test('buildBlockNotice: 連結後の長さで省略を判定する (境界ちょうど)', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'text', text: 'あ'.repeat(NOTICE_TEXT_LIMIT - 1) }, { type: 'text', text: 'い' }] },
  ]
  const expected = `${'あ'.repeat(NOTICE_TEXT_LIMIT - 1)}い`
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\n${expected}`)
})

test('buildBlockNotice: text 以外のブロック数を数えて添付の行を最後に出す', () => {
  const messages: NoticeMessage[] = [
    { content: [{ type: 'image' }, { type: 'text', text: 'hi' }, { type: 'file' }] },
  ]
  assert.equal(
    buildBlockNotice({ idleMinutes: 75, messages }, 'ja'),
    `${HEAD}\n破棄された入力:\nhi\n(画像などテキスト以外の添付 2 件も破棄されました)`,
  )
})

test('buildBlockNotice: テキストがなく添付だけなら添付の行だけを足す', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'image' }] }]
  assert.equal(
    buildBlockNotice({ idleMinutes: 75, messages }, 'ja'),
    `${HEAD}\n(画像などテキスト以外の添付 1 件も破棄されました)`,
  )
})

test('buildBlockNotice: 改行を含む text はそのまま載せる', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: '1 行目\n2 行目' }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'ja'), `${HEAD}\n破棄された入力:\n1 行目\n2 行目`)
})

// --- 表示言語 (spec-ui v0.5 §F) ---

test('buildBlockNotice: 英語の文面', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'image' }, { type: 'text', text: 'hello' }] }]
  assert.equal(
    buildBlockNotice({ idleMinutes: 75, messages }, 'en'),
    [
      'Send blocked (75 minutes since the last response, as the cache has likely expired).',
      'You can allow the next single send with /unlock.',
      'Discarded input:',
      'hello',
      '(1 non-text attachments such as images were also discarded)',
    ].join('\n'),
  )
})

test('buildBlockNotice: 中国語の文面', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'image' }, { type: 'text', text: '你好' }] }]
  assert.equal(
    buildBlockNotice({ idleMinutes: 75, messages }, 'zh-CN'),
    [
      '已阻止发送(距最后一次响应 75 分钟，因为缓存很可能已过期)。',
      '可用 /unlock 允许下 1 次发送。',
      '已丢弃的输入：',
      '你好',
      '(另有 1 条图片等非文本附件被丢弃)',
    ].join('\n'),
  )
})

test('buildBlockNotice: 英語と中国語の省略記号', () => {
  const body = 'a'.repeat(NOTICE_TEXT_LIMIT + 1)
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: body }] }]
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'en').endsWith('…(truncated)'), true)
  assert.equal(buildBlockNotice({ idleMinutes: 75, messages }, 'zh-CN').endsWith('…(以下省略)'), true)
})
