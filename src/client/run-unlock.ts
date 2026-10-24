/**
 * バナーのボタンから `/unlock` を実行する(spec-ui.md §E2)。React に依存しないので Node のテストからも使える。
 *
 * `remote.commands.execute` は `RemoteResult<object | undefined>` を返す
 * (`{ ok: true, value }` / `{ ok: false, error }`。value が undefined ならコマンドが見つからない)。
 * 根拠は docs/spike.md「クライアント側 `remote.commands` の inject」。
 */
import type { Locale } from '../i18n.ts'
import { MESSAGES } from '../messages.ts'

/**
 * `execute` の戻り値から、利用者に見せる失敗の文面を決める。成功なら undefined。
 * 成功時の `/unlock` の結果(許可した・まだ有効など)は会話のコマンド結果に出るので、ここでは扱わない。
 */
export function unlockFailure(result: unknown, locale: Locale): string | undefined {
  const m = MESSAGES[locale]
  if (typeof result !== 'object' || result === null) return m.bannerUnlockFailed('unexpected response')
  const record = result as Record<string, unknown>
  if (record['ok'] === true) return record['value'] === undefined ? m.bannerUnlockNotFound : undefined
  if (record['ok'] === false) return m.bannerUnlockFailed(describeError(record['error']))
  return m.bannerUnlockFailed('unexpected response')
}

/** `/unlock` を実行し、失敗したら利用者に見せる文面を返す。成功なら undefined。例外も失敗として扱う。 */
export async function runUnlock(execute: () => Promise<unknown>, locale: Locale): Promise<string | undefined> {
  let result: unknown
  try {
    result = await execute()
  } catch (error) {
    return MESSAGES[locale].bannerUnlockFailed(describeError(error))
  }
  return unlockFailure(result, locale)
}

/** Remote のエラー(`code` と `message`)や例外を 1 行の説明にする。翻訳しない。 */
function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error)
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (typeof code === 'string' && typeof message === 'string' && message !== '') return `${code}: ${message}`
  if (typeof code === 'string') return code
  if (typeof message === 'string' && message !== '') return message
  return 'unknown error'
}
