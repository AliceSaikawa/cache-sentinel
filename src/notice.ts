/**
 * ブロックの会話表示 (spec-ui v0.5 §D) の純粋部品。
 * 拒否したステップへ入る予定だった入力から、会話に出す文面 (`buildBlockNotice`) を作る。
 * 同じ文面の連続通知を抑える判定 (`NoticeDedupe`) も置く。
 * 副作用 (session.append・ログ) は呼び出し側が持つ。
 * 文面は書き込み時点の表示言語 (spec-ui v0.5 §F) で作る。
 */

import type { Locale } from './i18n.ts'
import { MESSAGES, type Messages } from './messages.ts'

/** session.append に渡すコマンド結果ブロックの最小形。 */
export interface NoticeBlock {
  readonly type: string
  readonly text?: unknown
}

/**
 * 入力の出どころの最小形 (issue #29)。
 * DSH の型では `source` も `kind` も必須だが、ここでは省けるものとして読む。
 * 省いた入力は出どころが分からないので、本文を隠さずユーザーの送信と同じく本文を載せる。
 * 入力禁止の判定 (spec.md §3) では、省いた入力はユーザーの送信に数えない。
 * `summary` は「その入力を 1 行で説明する文」で、モデル向けの本文の代わりに表示するもの
 * (根拠は spike.md「入力の出どころの form / summary の調査」)。
 */
export interface NoticeSource {
  /** 出どころの名前。`'user'` はユーザーの送信。無ければユーザーの送信と同じく本文を載せる。 */
  readonly kind?: string
  readonly summary?: unknown
}

/** 表示対象メッセージの最小形 (`content` と `source` だけ見る)。 */
export interface NoticeMessage {
  readonly content: readonly NoticeBlock[]
  readonly source?: NoticeSource
}

/** 破棄した入力を 1 件あたり何文字まで載せるか。 */
export const NOTICE_TEXT_LIMIT = 2000

/** 同じ文面の連続通知を再び出すまでの最短間隔 (spec-ui §D)。 */
export const NOTICE_DEDUPE_INTERVAL_MS = 10 * 60_000

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
 * そのメッセージを「破棄された入力」に 1 件として載せる文面を返す (spec-ui §D、#29)。
 * 出どころ (`source`) で決める。
 * - `kind: 'user'`、または `source` (`kind`) が無い → 本文 (`text` ブロックの連結)。
 *   `source` が無い入力がここに来るのは、`user` の入力と同じステップで拒否されたときだけ。
 * - それ以外で `summary` が文字列 → その summary(モデル向けの本文は出さない)。
 * - それ以外 → 出どころ名だけの 1 行。
 * どれも空文字なら、その入力は「破棄された入力」に数えない。
 */
function entryOf(message: NoticeMessage, m: Messages): string {
  const kind = message.source?.kind
  if (kind === undefined || kind === 'user') return textOf(message)
  return typeof message.source?.summary === 'string' ? message.source.summary : m.noticeInputSource(kind)
}

/**
 * 比較用の「破棄された入力」の部分 (spec-ui §D)。見出し行と、入力・添付の行だけを返す。
 * 1 行目の経過分はブロックのたびに増えるので、これを除いた部分で連続通知を判定する。
 * 文面を組み立てる `buildBlockNotice` と同じ走査を使う。
 */
function discardedPart(messages: readonly NoticeMessage[], m: Messages): string {
  const lines: string[] = []
  const entries: string[] = []
  let attachments = 0
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'text') attachments++
    }
    const entry = entryOf(message, m)
    if (entry !== '') entries.push(truncate(entry, m.noticeOmitted))
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

/**
 * 拒否した入力から会話に出す文面を作る (spec-ui v0.5 §D)。
 * - 1 行目: 送信を止めた理由 (idleMinutes)。
 * - 2 行目: `/unlock` の案内。
 * - 破棄された入力があれば「破棄された入力:」の後に 1 件 1 行 (件の間は空行 1 つ)、
 *   1 件が `NOTICE_TEXT_LIMIT` 文字を超えたら省略記号を付ける。
 *   1 件の文面は出どころ (`source`) で決める (`entryOf`)。
 * - `type` が `'text'` 以外のブロックの総数 k が 1 以上なら最後に添付の行を足す。
 * 行は `\n` で結合し、末尾に改行は付けない。
 * `locale` は書き込み時点の表示言語 (spec-ui v0.5 §F)。
 */
export function buildBlockNotice(
  input: { idleMinutes: number; messages: readonly NoticeMessage[] },
  locale: Locale,
): string {
  const m = MESSAGES[locale]
  const head = [m.noticeBlocked(input.idleMinutes), m.noticeUnlockHint].join('\n')
  const body = discardedPart(input.messages, m)
  return body === '' ? head : `${head}\n${body}`
}

/**
 * 連続通知の比較に使う文面 (spec-ui §D、#30)。純粋関数。
 * 実際に会話へ書く文面のうち、1 行目の経過分を除いた部分 (破棄された入力と添付)。
 * 経過分はブロックのたびに増えるため、比較には使わない。
 * `buildBlockNotice` と同じ走査 (`discardedPart`) なので、#29 の出どころごとの文面もそのまま比較される。
 */
export function noticeDedupeKey(messages: readonly NoticeMessage[], locale: Locale): string {
  return discardedPart(messages, MESSAGES[locale])
}

/**
 * 同じ文面の連続通知の抑制 (spec-ui §D、#30)。DSH には依存しない。
 *
 * セッションごとに「最後に出した文面」と「その時刻」だけをメモリに持つ (永続化しない)。
 * 直前に出した文面と同じなら `intervalMs` 未満は抑え、違う文面ならすぐ出す。
 * 判定 (`shouldSend`) は記録を変えない。呼び出し側が会話への追加に成功してから `record` する。
 * 抑えたときは記録しないので、間隔の起点は最後に出した通知のままになる。
 */
export class NoticeDedupe {
  /** セッション id → 最後に出した文面と時刻。 */
  private readonly lastSent = new Map<string, { text: string; at: number }>()

  private readonly intervalMs: number

  /** @param intervalMs - 同じ文面を再び出すまでの最短間隔 (ミリ秒)。 */
  constructor(intervalMs: number) {
    this.intervalMs = intervalMs
  }

  /** 保持している記録の数。 */
  get size(): number {
    return this.lastSent.size
  }

  /**
   * その文面を今出してよいかを返す。記録は変えない。
   * - 未通知のセッション、または文面が直前と違う → true。
   * - 直前と同じ文面 → 最後に出してから `intervalMs` 未満なら false。
   *   ちょうど `intervalMs` の経過と、時計巻き戻り (負の経過) は true。
   */
  shouldSend(sessionId: string, now: number, text: string): boolean {
    const last = this.lastSent.get(sessionId)
    if (last === undefined || last.text !== text) return true
    const elapsed = now - last.at
    return !(elapsed >= 0 && elapsed < this.intervalMs)
  }

  /** 会話に出した文面と時刻を、そのセッションの「最後に出した通知」として記録する。 */
  record(sessionId: string, now: number, text: string): void {
    this.lastSent.set(sessionId, { text, at: now })
  }

  /** そのセッションの記録を消す。次の通知は文面に関わらず出る。 */
  forget(sessionId: string): void {
    this.lastSent.delete(sessionId)
  }

  /**
   * 判定に効かなくなった記録を消す。`now - at >= intervalMs` のものを消す。
   * 時計巻き戻り (負の経過) の記録は、時計が追いつけばまた効くので残す。
   */
  prune(now: number): void {
    for (const [sessionId, last] of this.lastSent) {
      if (now - last.at >= this.intervalMs) {
        this.lastSent.delete(sessionId)
      }
    }
  }
}
