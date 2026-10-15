/** 状態の取得(spec-ui.md §E2)。React に依存しないので Node のテストからも使える。 */
import { parseStatus, statusUrl, type StatusLike } from './banner.ts'

/** 状態を 1 回取得する。失敗したら undefined(表示しない)。 */
export async function fetchStatus(
  sessionId: string,
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StatusLike | undefined> {
  try {
    const response = await fetchImpl(statusUrl(base, sessionId), { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) return undefined
    return parseStatus(await response.json())
  } catch {
    return undefined
  }
}
