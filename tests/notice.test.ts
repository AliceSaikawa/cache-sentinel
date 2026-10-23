import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBlockNotice,
  NOTICE_DEDUPE_INTERVAL_MS,
  NOTICE_TEXT_LIMIT,
  NoticeDedupe,
  noticeDedupeKey,
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

// --- 連続通知の抑制 (spec-ui §D、#30) ---

const DEDUPE_INTERVAL = NOTICE_DEDUPE_INTERVAL_MS

test('NoticeDedupe: 間隔は 10 分', () => {
  assert.equal(DEDUPE_INTERVAL, 600_000)
})

/** 出してよければ出したとして記録する(block.ts の通知経路で append が成功したときの使い方)。 */
function sendIfAllowed(dedupe: NoticeDedupe, sessionId: string, now: number, text: string): boolean {
  if (!dedupe.shouldSend(sessionId, now, text)) return false
  dedupe.record(sessionId, now, text)
  return true
}

test('NoticeDedupe: 初回は出す', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, '同じ文面'), true)
})

test('NoticeDedupe: 同じ文面は間隔未満なら抑え、ちょうどで出す', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, '同じ文面'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 1, '同じ文面'), false)
  assert.equal(sendIfAllowed(dedupe, 's1', 599_999, '同じ文面'), false)
  assert.equal(sendIfAllowed(dedupe, 's1', 600_000, '同じ文面'), true)
})

test('NoticeDedupe: 抑えても記録時刻は変わらない', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 300_000, 'A'), false)
  // 抑えた 300_000 では更新しないので、起点は 0 のまま。
  assert.equal(sendIfAllowed(dedupe, 's1', 599_999, 'A'), false)
  assert.equal(sendIfAllowed(dedupe, 's1', 600_000, 'A'), true)
})

test('NoticeDedupe: 文面が変われば間隔内でもすぐ出す', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 1, 'B'), true)
  // 直前が B なので、その次の B は抑える。
  assert.equal(sendIfAllowed(dedupe, 's1', 2, 'B'), false)
})

test('NoticeDedupe: A → B → A で A が再び出る', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 1, 'B'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 2, 'A'), true)
  // 3 回目の A は直前が A なので抑える。
  assert.equal(sendIfAllowed(dedupe, 's1', 3, 'A'), false)
})

test('NoticeDedupe: 文面が変わると、同じ文面の起点がそこで更新される', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 500_000, 'B'), true)
  // B の起点は 500_000、A の起点は 0。直前が B なので A は出せ、起点が 500_001 になる。
  assert.equal(sendIfAllowed(dedupe, 's1', 500_001, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 1_100_000, 'A'), false)
  assert.equal(sendIfAllowed(dedupe, 's1', 1_100_001, 'A'), true)
})

test('NoticeDedupe: セッションごとに独立して判定する', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's2', 1, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 2, 'A'), false)
  assert.equal(sendIfAllowed(dedupe, 's2', 3, 'A'), false)
  assert.equal(sendIfAllowed(dedupe, 's1', 600_000, 'A'), true)
})

test('NoticeDedupe: 時計が巻き戻って経過が負なら出す', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 600_000, 'A'), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 500_000, 'A'), true)
})

test('NoticeDedupe: 空文字の文面でも同じ規則で判定する', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(sendIfAllowed(dedupe, 's1', 0, ''), true)
  assert.equal(sendIfAllowed(dedupe, 's1', 1, ''), false)
})

test('NoticeDedupe: shouldSend だけでは記録しない(出せなかった通知は次も出す)', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  assert.equal(dedupe.shouldSend('s1', 0, 'A'), true)
  assert.equal(dedupe.shouldSend('s1', 1, 'A'), true)
  dedupe.record('s1', 2, 'A')
  assert.equal(dedupe.shouldSend('s1', 3, 'A'), false)
})

test('NoticeDedupe: forget の後は同じ文面でも出す。他のセッションの記録は残る', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  sendIfAllowed(dedupe, 's1', 0, 'A')
  sendIfAllowed(dedupe, 's2', 0, 'A')
  dedupe.forget('s1')
  assert.equal(dedupe.shouldSend('s1', 1, 'A'), true)
  assert.equal(dedupe.shouldSend('s2', 1, 'A'), false)
  // 記録の無いセッションの forget は何もしない。
  dedupe.forget('s3')
  assert.equal(dedupe.size, 1)
})

test('NoticeDedupe: prune は間隔以上たった記録だけを捨てる', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  sendIfAllowed(dedupe, 'old', 0, 'A')
  sendIfAllowed(dedupe, 'edge', 1, 'A')
  sendIfAllowed(dedupe, 'new', 2, 'A')
  assert.equal(dedupe.size, 3)

  // old は 600_001、edge はちょうど 600_000 経過、new は 599_999。
  dedupe.prune(600_001)

  assert.equal(dedupe.size, 1)
  assert.equal(dedupe.shouldSend('new', 600_001, 'A'), false)
})

test('NoticeDedupe: prune は時計巻き戻りの記録を残す', () => {
  const dedupe = new NoticeDedupe(DEDUPE_INTERVAL)
  sendIfAllowed(dedupe, 's1', 1_000_000, 'A')

  dedupe.prune(0)

  assert.equal(dedupe.size, 1)
  // 時計が追いつけば、その記録でまた抑える。
  assert.equal(dedupe.shouldSend('s1', 1_000_001, 'A'), false)
})

test('noticeDedupeKey: 経過分を除いた部分を返す', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: '同じ入力' }] }]

  assert.equal(noticeDedupeKey(messages, 'ja'), '破棄された入力:\n同じ入力')
})

test('noticeDedupeKey: 入力が違えば変わる', () => {
  const a: NoticeMessage[] = [{ content: [{ type: 'text', text: 'A' }] }]
  const b: NoticeMessage[] = [{ content: [{ type: 'text', text: 'B' }] }]

  assert.notEqual(noticeDedupeKey(a, 'ja'), noticeDedupeKey(b, 'ja'))
})

test('noticeDedupeKey: 切り詰め後の値で比較する(2000 文字超は同じ鍵)', () => {
  const head = 'あ'.repeat(NOTICE_TEXT_LIMIT)
  const a: NoticeMessage[] = [{ content: [{ type: 'text', text: `${head}1` }] }]
  const b: NoticeMessage[] = [{ content: [{ type: 'text', text: `${head}2` }] }]

  assert.equal(noticeDedupeKey(a, 'ja'), noticeDedupeKey(b, 'ja'))
})

test('noticeDedupeKey: 入力がなければ空文字', () => {
  assert.equal(noticeDedupeKey([], 'ja'), '')
})

test('noticeDedupeKey: 添付だけなら添付の行になる', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'image' }] }]
  assert.equal(noticeDedupeKey(messages, 'ja'), '(画像などテキスト以外の添付 1 件も破棄されました)')
})

test('noticeDedupeKey: 表示言語ごとの文面で比較する', () => {
  const messages: NoticeMessage[] = [{ content: [{ type: 'text', text: 'hello' }] }]
  assert.equal(noticeDedupeKey(messages, 'en'), 'Discarded input:\nhello')
  assert.equal(noticeDedupeKey(messages, 'zh-CN'), '已丢弃的输入：\nhello')
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
