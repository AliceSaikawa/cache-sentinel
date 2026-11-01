/**
 * cache-sentinel の設定ページ (#10)。DSH の「プラグイン」画面の cache-sentinel のページ
 * (`plugins.bundle.config` スロット、キーはパッケージ名)に、設定フォームを出す。
 *
 * - 値の読み書きは DSH の `configForms`(Host の設定サービスの、エントリ `cache-sentinel` の分)を通す。
 *   保存した値は Host がスキーマで検証してからプロファイルの patch に書き、プラグインに反映する(docs/spike.md S3・S5)。
 * - 欄の並び・型・下限は `settings-fields.ts`(元は `src/config.ts` の `CONFIG_KEYS`)。
 * - 見た目は DSH 公式の設定ページと同じ部品(`SettingsForm`・`SettingsValueField`・`Switch`・`SegmentedControl`)。
 *   公式ページにない「モード」「スイッチ」の行だけ、公式ページ(Web 検索・サブエージェント)と同じ形の CSS を書く。
 */
import {
  SegmentedControl,
  SettingsForm,
  SettingsFormModel,
  SettingsValueField,
  Switch,
  Tag,
  type SettingsFieldState,
  type SettingsFormScope,
  type SettingsFormShell,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement as h } from 'react'
import type { Locale } from '../i18n.ts'
import { MESSAGES, type SettingsKey } from '../messages.ts'
import { MODES, type Mode } from '../modes.ts'
import { fieldSpecs, SETTINGS_FIELDS } from './settings-fields.ts'

/** Host のエントリ id(cordis.patch.yml の `id`)。設定サービスの名前空間になる。 */
export const ENTRY_ID = 'cache-sentinel'
/** 設定ページを出すスロットのキー(パッケージ名)。 */
export const PACKAGE_NAME = 'cache-sentinel'

/** 設定ページの表示状態。 */
export type SettingsPageState = SettingsFormShell & Record<SettingsKey, SettingsFieldState>

/** スロットに渡す face。`hooks.settingsPage` は部品側で `useSettingsPage` になる。 */
export interface SettingsPageFace {
  hooks: { settingsPage: SnapshotStore<SettingsPageState> }
  locale: Locale
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

/** 部品が受け取る props。 */
export interface SettingsPageProps {
  view?: 'summary' | 'page'
  locale: Locale
  useSettingsPage: <S>(selector: (state: SettingsPageState) => S) => S
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

/** 設定フォームの状態(入力中の値・検証・保存)を持つ。DSH の `SettingsFormModel` に任せる。 */
export class SettingsPageController {
  private readonly form: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<SettingsPageState>
  private readonly locale: Locale

  constructor(scope: SettingsFormScope<Record<string, unknown>>, locale: Locale) {
    this.locale = locale
    this.form = new SettingsFormModel(scope, fieldSpecs())
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SettingsPageState {
    const fields = Object.fromEntries(SETTINGS_FIELDS.map((field) => [field.key, this.form.field(field.key)]))
    return { ...this.form.shell(), ...(fields as Record<SettingsKey, SettingsFieldState>) }
  }

  face(): SettingsPageFace {
    return { hooks: { settingsPage: this.store }, locale: this.locale, ...this.form.actions() }
  }

  dispose(): void {
    this.form.dispose()
  }
}

/**
 * モード・スイッチの行の見た目。`SettingsValueField` と同じ形(見出しの行・説明・行の間の線・「変更あり」と
 * 「既定値に戻す」)にそろえる。値は primitives 0.2.2-alpha.2 の `settings-form/fields.module.css` から写した
 * (docs/spike.md S5)。行の間の線は、入力欄の行も含めて全行に引く。
 */
const CSS = `
.cache-sentinel-settings-rows {
  display: flex;
  flex-direction: column;
}
.cache-sentinel-settings-rows > * + * {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.cache-sentinel-settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.cache-sentinel-settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cache-sentinel-settings-label {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}
.cache-sentinel-settings-badges {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.cache-sentinel-settings-reset {
  padding: 0;
  border: none;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
}
.cache-sentinel-settings-reset:disabled {
  cursor: default;
}
@media (hover: hover) {
  .cache-sentinel-settings-reset:hover:not(:disabled) {
    color: var(--dsw-alias-label-primary);
  }
}
.cache-sentinel-settings-hint,
.cache-sentinel-settings-note {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}
.cache-sentinel-settings-note {
  padding-top: 4px;
}
`

/** 見出しの行: 見出し、既定から変えているときは「変更あり」と「既定値に戻す」、行末の操作(スイッチ)。 */
function head(
  props: SettingsPageProps,
  key: SettingsKey,
  state: SettingsFieldState,
  disabled: boolean,
  labelId: string,
  control: unknown = null,
) {
  const m = MESSAGES[props.locale]
  return h(
    'div',
    { className: 'cache-sentinel-settings-head' },
    h('span', { id: labelId, className: 'cache-sentinel-settings-label' }, m.settingsLabels[key]),
    state.overridden
      ? h(
          'span',
          { className: 'cache-sentinel-settings-badges' },
          h(Tag, { tone: 'neutral' }, m.settingsOverridden),
          h(
            'button',
            { type: 'button', className: 'cache-sentinel-settings-reset', disabled, onClick: () => props.resetField(key) },
            m.settingsReset,
          ),
        )
      : null,
    control,
  )
}

/** 設定ページの部品。`summary` を求められたら何も出さない(バンドルの設定は `page` だけが描かれる)。 */
export function SettingsPage(props: SettingsPageProps) {
  const state = props.useSettingsPage((snapshot) => snapshot)
  if (props.view === 'summary') return null
  const m = MESSAGES[props.locale]
  const disabled = !state.writable || state.saving

  const rows = SETTINGS_FIELDS.map((field) => {
    const key = field.key
    const id = `cache-sentinel-settings-${key}`
    const fieldState = state[key]
    switch (field.kind) {
      case 'integer':
        return h(SettingsValueField, {
          key,
          id,
          label: m.settingsLabels[key],
          hint: m.settingsHints[key],
          overriddenLabel: m.settingsOverridden,
          resetLabel: m.settingsReset,
          invalidLabel: m.settingsInvalidInteger(field.min),
          numeric: true,
          disabled,
          text: fieldState.text,
          overridden: fieldState.overridden,
          invalid: fieldState.invalid,
          onEdit: (text: string) => props.edit(key, text),
          onReset: () => props.resetField(key),
        })
      case 'boolean':
        return h(
          'div',
          { key, className: 'cache-sentinel-settings-field', 'data-testid': id },
          head(
            props,
            key,
            fieldState,
            disabled,
            `${id}-label`,
            h(Switch, {
              checked: fieldState.text === 'true',
              label: m.settingsLabels[key],
              disabled,
              onChange: (next: boolean) => props.edit(key, String(next)),
            }),
          ),
          h('p', { className: 'cache-sentinel-settings-hint' }, m.settingsHints[key]),
        )
      case 'mode':
        return h(
          'div',
          { key, className: 'cache-sentinel-settings-field', 'data-testid': id },
          head(props, key, fieldState, disabled, `${id}-label`),
          h(SegmentedControl, {
            id,
            value: (MODES as readonly string[]).includes(fieldState.text) ? (fieldState.text as Mode) : 'block',
            options: MODES.map((mode) => ({ value: mode, label: m.settingsModeOptions[mode] })),
            label: m.settingsLabels.mode,
            disabled,
            onChange: (next: Mode) => props.edit('mode', next),
          }),
          h('p', { className: 'cache-sentinel-settings-hint' }, m.settingsHints.mode),
        )
    }
  })

  return h(
    SettingsForm,
    {
      labels: {
        unavailable: m.settingsUnavailable,
        readOnly: m.settingsReadOnly,
        saveFailed: m.settingsSaveFailed,
        save: m.settingsSave,
        saving: m.settingsSaving,
      },
      state,
      onSave: props.save,
      onDiscard: props.discard,
    },
    h('style', null, CSS),
    h('div', { className: 'cache-sentinel-settings-rows' }, ...rows),
    h('p', { className: 'cache-sentinel-settings-note' }, m.settingsStateFileNote),
  )
}
