/**
 * `@deepseek-ai/dsh-client-ui-primitives` の最小の型宣言。DSH のシェルが実行時に提供する(バンドルしない)ため、
 * 依存を足さずに、設定ページ (#10) が使う部品だけを宣言する。
 * 形は同パッケージ 0.2.2-alpha.2 の `lib/types/settings-form/*.d.ts`・`Switch.d.ts`・`SegmentedControl.d.ts`・`Tag.d.ts` から
 * 書き写した(docs/spike.md S5)。0.2.0-rc.2・0.2.1-rc.5 も同じ名前を export している。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export type SettingsFieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }

  export interface SettingsFieldSpec {
    field: string
    format: (value: unknown) => string
    parse: (text: string) => SettingsFieldWrite | undefined
  }

  export interface SettingsFormScopeSnapshot<T> {
    status: 'loading' | 'ready' | 'unavailable'
    value: T | undefined
    base: unknown
    user: unknown
    writable: boolean
    revision: number | undefined
  }

  export type SettingsFormPathOp =
    | { op: 'set'; path: readonly string[]; value: unknown }
    | { op: 'unset'; path: readonly string[] }

  export interface SettingsFormScope<T> {
    getSnapshot(): SettingsFormScopeSnapshot<T>
    subscribe(listener: () => void): () => void
    mutate(ops: readonly SettingsFormPathOp[], expectedRevision?: number): Promise<boolean>
  }

  export interface SettingsFieldState {
    text: string
    overridden: boolean
    invalid: boolean
  }

  export interface SettingsFormShell {
    available: boolean
    writable: boolean
    dirty: boolean
    invalid: boolean
    saving: boolean
    failed: boolean
  }

  export interface SettingsFormActions {
    edit: (field: string, text: string) => void
    resetField: (field: string) => void
    save: () => void
    discard: () => void
  }

  /** `getSnapshot` と `subscribe` の組(スロットの `hooks` に渡すと `use<名前>` になる)。 */
  export interface SnapshotStore<S> {
    getSnapshot(): S
    subscribe(listener: () => void): () => void
  }

  export class SettingsFormModel<T> {
    constructor(scope: SettingsFormScope<T>, specs: SettingsFieldSpec[])
    bind<S>(project: () => S): SnapshotStore<S>
    shell(): SettingsFormShell
    field(field: string): SettingsFieldState
    actions(): SettingsFormActions
    dispose(): void
  }

  export interface SettingsFormLabels {
    unavailable: string
    readOnly: string
    saveFailed: string
    save: string
    saving: string
  }

  export function SettingsForm(props: {
    labels: SettingsFormLabels
    state: SettingsFormShell
    onSave: () => void
    onDiscard: () => void
    children: unknown
  }): unknown

  export function SettingsValueField(props: {
    id: string
    label: string
    hint?: string
    text: string
    overridden: boolean
    invalid: boolean
    overriddenLabel: string
    resetLabel: string
    invalidLabel: string
    disabled: boolean
    numeric?: boolean
    placeholder?: string
    onEdit: (text: string) => void
    onReset: () => void
  }): unknown

  export function Switch(props: {
    checked: boolean
    onChange: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string
    className?: string
  }): unknown

  export function Tag(props: {
    tone?: 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'
    className?: string
    children?: unknown
  }): unknown

  export function SegmentedControl<Value extends string>(props: {
    id: string
    value: Value
    options: readonly { value: Value; label: string; disabled?: boolean; title?: string }[]
    onChange: (next: Value) => void
    label: string
    disabled?: boolean
    className?: string
  }): unknown
}
