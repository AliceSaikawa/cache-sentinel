/** 動作モード (spec v0.4 §A)。各モジュールが共有する型だけを置く。 */
export type Mode = 'block' | 'archive' | 'both' | 'off'

export const MODES: readonly Mode[] = ['block', 'archive', 'both', 'off']

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}
