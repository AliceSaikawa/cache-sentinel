/**
 * React の最小の型宣言。React は DSH のシェルが実行時に提供する(バンドルしない)ため、
 * 依存を足さずに、このプラグインが使う API だけを宣言する。
 */
declare module 'react' {
  export type ReactNode = unknown
  export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode
  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]): T
}
