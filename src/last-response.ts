/**
 * 最終応答時刻 (lastResponseAt) の取得とキャッシュ (spec §7)。
 * イベント列の走査は純粋関数 `findLastResponseAt`、セッション単位のメモ化は
 * `LastResponseTracker` が担当する。DSH の API 呼び出し (load) はコンストラクタで注入する。
 */

/** 時刻を持つイベントの最小形 (DSH の session event と互換)。 */
export interface TimedEvent {
  readonly type: string
  readonly time: number
}

/** モデル応答の終わりを表すイベント種別。 */
const RESPONSE_EVENT_TYPE = 'step/end'

/**
 * 末尾から走査し、最初に見つかった `step/end` の `time` を返す。
 * `time` が有限数でない要素は飛ばして続ける。1 つもなければ undefined (新規セッション)。
 */
export function findLastResponseAt(events: readonly TimedEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event === undefined) continue
    if (event.type !== RESPONSE_EVENT_TYPE) continue
    if (!Number.isFinite(event.time)) continue
    return event.time
  }
  return undefined
}

/**
 * セッション id ごとに最終応答時刻をキャッシュする。
 * 初回の `get` だけ `load` でイベント列を取りに行き、以後は `observe` で更新する。
 */
export class LastResponseTracker {
  /** セッション id → 最終応答時刻。undefined も「取得済みで応答なし」として保持する。 */
  private readonly cache = new Map<string, number | undefined>()

  /** セッションのイベント列を返す。取得できなければ undefined。 */
  private readonly load: (sessionId: string) => readonly TimedEvent[] | undefined

  /**
   * @param load - セッションのイベント列を返す。取得できなければ undefined。
   */
  constructor(load: (sessionId: string) => readonly TimedEvent[] | undefined) {
    this.load = load
  }

  /**
   * キャッシュにあればそれを返す。なければ `load` して `findLastResponseAt` の結果をキャッシュする。
   * `load` が undefined を返した場合と例外を投げた場合は、キャッシュせずそのまま返す / 伝播する。
   */
  get(sessionId: string): number | undefined {
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId)
    }
    const events = this.load(sessionId)
    if (events === undefined) {
      return undefined
    }
    const lastResponseAt = findLastResponseAt(events)
    this.cache.set(sessionId, lastResponseAt)
    return lastResponseAt
  }

  /**
   * `step/end` の観測をキャッシュに反映する。キャッシュ値より新しいときだけ更新し、
   * 未登録のセッションでも登録する。それ以外のイベントは無視する。
   */
  observe(sessionId: string, event: TimedEvent): void {
    if (event.type !== RESPONSE_EVENT_TYPE) return
    if (!Number.isFinite(event.time)) return
    const cached = this.cache.get(sessionId)
    if (cached !== undefined && event.time <= cached) return
    this.cache.set(sessionId, event.time)
  }

  /** セッションのキャッシュを捨てる。次回の `get` は再び `load` を呼ぶ。 */
  forget(sessionId: string): void {
    this.cache.delete(sessionId)
  }
}
