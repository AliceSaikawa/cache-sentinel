/** 動作モード (spec v0.4 §A)。各モジュールが共有する型だけを置く。 */
export type Mode = 'block' | 'archive' | 'both' | 'off'

export const MODES: readonly Mode[] = ['block', 'archive', 'both', 'off']

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && MODES.includes(value as Mode)
}

/** 文字列を Mode に直す。不正なら `fallback` を使う(設定 UI の表示用)。 */
export function asMode(text: string, fallback: Mode): Mode {
  return isMode(text) ? text : fallback
}
