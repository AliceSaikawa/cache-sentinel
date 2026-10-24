/**
 * ブロックの会話表示 (spec-ui v0.5 §D) の純粋部品。
 * 拒否したステップへ入る予定だった入力から、会話に出す文面 (`buildBlockNotice`) を作る。
 * 副作用 (session.append) は呼び出し側が持つ。
 * 文面は書き込み時点の表示言語 (spec-ui v0.5 §F) で作る。
 */

import type { Locale } from './i18n.ts'
import { MESSAGES } from './messages.ts'

/** session.append に渡すコマンド結果ブロックの最小形。 */
export interface NoticeBlock {
  readonly type: string
  readonly text?: unknown
}

/** 表示対象メッセージの最小形 (`content` だけ見る)。 */
export interface NoticeMessage {
  readonly content: readonly NoticeBlock[]
}

/** 破棄した入力を 1 件あたり何文字まで載せるか。 */
export const NOTICE_TEXT_LIMIT = 2000

/** 上限を超えていれば先頭 `NOTICE_TEXT_LIMIT` 文字に省略記号を付ける。 */
function truncate(text: string, omitted: string): string {
  return text.length > NOTICE_TEXT_LIMIT ? text.slice(0, NOTICE_TEXT_LIMIT) + omitted : text
}

/**
 * メッセージ 1 件のうち `type: 'text'` かつ `text` が文字列のブロックを区切りなしで連結する。
 * 連結結果が空文字なら「破棄された入力」として数えない。
 */
function textOf(message: NoticeMessage): string {
  let joined = ''
  for (const block of message.content) {
    if (block.type !== 'text') continue
    if (typeof block.text !== 'string') continue
    joined += block.text
  }
  return joined
}

/**
 * 拒否した入力から会話に出す文面を作る (spec-ui v0.5 §D)。
 * - 1 行目: 送信を止めた理由 (idleMinutes)。
 * - 2 行目: `/unlock` の案内。
 * - 破棄された入力があれば「破棄された入力:」の後に 1 件 1 行 (件の間は空行 1 つ)、
 *   1 件が `NOTICE_TEXT_LIMIT` 文字を超えたら省略記号を付ける。
 * - `type` が `'text'` 以外のブロックの総数 k が 1 以上なら最後に添付の行を足す。
 * 行は `\n` で結合し、末尾に改行は付けない。
 * `locale` は書き込み時点の表示言語 (spec-ui v0.5 §F)。
 */
export function buildBlockNotice(
  input: { idleMinutes: number; messages: readonly NoticeMessage[] },
  locale: Locale,
): string {
  const m = MESSAGES[locale]
  const lines = [m.noticeBlocked(input.idleMinutes), m.noticeUnlockHint]

  const entries: string[] = []
  let attachments = 0
  for (const message of input.messages) {
    for (const block of message.content) {
      if (block.type !== 'text') attachments++
    }
    const text = textOf(message)
    if (text !== '') entries.push(truncate(text, m.noticeOmitted))
  }

  if (entries.length > 0) {
    lines.push(m.noticeDiscarded)
    lines.push(entries.join('\n\n'))
  }
  if (attachments >= 1) {
    lines.push(m.noticeAttachments(attachments))
  }
  return lines.join('\n')
}
