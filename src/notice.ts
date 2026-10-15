/**
 * ブロックの会話表示 (spec-ui v0.5 §D) の純粋部品。
 * 拒否したステップへ入る予定だった入力から、会話に出す文面 (`buildBlockNotice`) と、
 * 入力 0 件の連続拒否を間引く `NoticeThrottle` を提供する。
 * 副作用 (session.append) は呼び出し側が持つ。
 */

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

/** 上限を超えたときに末尾に付ける省略記号。 */
const OMITTED = '…(以下省略)'

/** 上限を超えていれば先頭 `NOTICE_TEXT_LIMIT` 文字に省略記号を付ける。 */
function truncate(text: string): string {
  return text.length > NOTICE_TEXT_LIMIT ? text.slice(0, NOTICE_TEXT_LIMIT) + OMITTED : text
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
 */
export function buildBlockNotice(input: { idleMinutes: number; messages: readonly NoticeMessage[] }): string {
  const lines = [
    `送信を止めました(最終応答から ${input.idleMinutes} 分。キャッシュが切れている可能性が高いため)。`,
    '/unlock で次の 1 回を許可できます。',
  ]

  const entries: string[] = []
  let attachments = 0
  for (const message of input.messages) {
    for (const block of message.content) {
      if (block.type !== 'text') attachments++
    }
    const text = textOf(message)
    if (text !== '') entries.push(truncate(text))
  }

  if (entries.length > 0) {
    lines.push('破棄された入力:')
    lines.push(entries.join('\n\n'))
  }
  if (attachments >= 1) {
    lines.push(`(画像などテキスト以外の添付 ${attachments} 件も破棄されました)`)
  }
  return lines.join('\n')
}

/**
 * 連続通知の抑制 (spec-ui v0.5 §D)。
 * 入力メッセージが 0 件の拒否は、同じセッションで直近 intervalMs 以内に通知していれば省く。
 * 入力メッセージがある (hasMessages) ときは毎回通知し、記録時刻を now に更新する。
 */
export class NoticeThrottle {
  /** セッション id → 最後に通知した時刻。 */
  private readonly lastNotified = new Map<string, number>()

  private readonly intervalMs: number

  /** @param intervalMs - 入力 0 件の拒否を再通知するまでの最短間隔 (ミリ秒)。 */
  constructor(intervalMs: number) {
    this.intervalMs = intervalMs
  }

  /**
   * 今回通知すべきかを返す。
   * - hasMessages が真なら常に true を返し、記録時刻を now に更新する。
   * - 偽なら、最後の通知から intervalMs 未満なら false、そうでなければ true を返して記録を now に更新する。
   * - 未通知のセッションは true。
   */
  shouldNotify(sessionId: string, now: number, hasMessages: boolean): boolean {
    const last = this.lastNotified.get(sessionId)
    if (!hasMessages && last !== undefined && now - last < this.intervalMs) {
      return false
    }
    this.lastNotified.set(sessionId, now)
    return true
  }
}
