/**
 * 表示言語の判定 (spec-ui v0.5 §F)。DSH には依存しない純粋関数のみ。
 *
 * 対応する言語は `en` / `ja` / `zh-CN` の 3 つ。判定できない場合と未対応の言語は `en`。
 * 環境の読み取りは呼び出し側(Host は `src/index.ts`、クライアントは `src/client/index.ts`)が行い、
 * ここには候補の文字列だけを渡す。
 */

/** 表示言語。 */
export type Locale = 'en' | 'ja' | 'zh-CN'

/** 対応する言語(テストや網羅確認で使う)。 */
export const LOCALES: readonly Locale[] = ['en', 'ja', 'zh-CN']

/** 判定で読み飛ばす値(正規化後の小文字)。 */
const SKIPPED: ReadonlySet<string> = new Set(['', 'c', 'posix'])

/**
 * 言語タグを比較しやすい形にする。
 * `@` 以降の修飾子と `.` 以降のエンコーディングを落とし、`_` を `-` とみなして小文字化する。
 * 例: `ja_JP.UTF-8` → `ja-jp`、`C.UTF-8` → `c`、`sr_RS@latin` → `sr-rs`。
 */
function normalize(candidate: string): string {
  const withoutModifier = candidate.split('@')[0] ?? ''
  const withoutEncoding = withoutModifier.split('.')[0] ?? ''
  return withoutEncoding.replace(/_/g, '-').trim().toLowerCase()
}

/**
 * 言語の候補を先頭から見て、最初に見つかったもので言語を決める (spec-ui v0.5 §F)。
 * - `undefined` と空文字、`C`、`POSIX` は飛ばして次の候補へ進む。
 * - `ja` で始まる → `ja`、`zh` で始まる → `zh-CN`、`en` で始まる → `en`。
 * - それ以外の値は未対応とみなして `en`。
 * - 候補がすべて読み飛ばされたら `en`。
 */
export function resolveLocale(candidates: readonly (string | undefined)[]): Locale {
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const normalized = normalize(candidate)
    if (SKIPPED.has(normalized)) continue
    if (normalized.startsWith('ja')) return 'ja'
    if (normalized.startsWith('zh')) return 'zh-CN'
    return 'en'
  }
  return 'en'
}
