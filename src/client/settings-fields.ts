/**
 * 設定ページ (#10) の各欄と、入力文字列 ⇄ 保存する値の変換。純粋関数のみ(React・DSH に依存しない)。
 *
 * DSH の設定フォーム(`@deepseek-ai/dsh-client-ui-primitives` の `SettingsFormModel`)は、各欄を
 * 「入力中の文字列」で持ち、保存時に `parse` が返す書き込み(set / clear)を Host に送る。
 * `parse` が undefined を返す入力は不正で、保存できない(docs/spike.md S5)。
 * 欄・型・下限は `src/config.ts` の `CONFIG_KEYS` から作るので、キーを足すのは 1 か所で済む。
 */
import { CONFIG_KEYS } from '../config.ts'
import type { SettingsKey } from '../messages.ts'
import { isMode } from '../modes.ts'

/** 1 欄の保存時の書き込み(primitives の `SettingsFieldWrite` と同じ形)。 */
export type FieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }

/** 1 欄の変換(primitives の `SettingsFieldSpec` と同じ形)。 */
export interface FieldSpec {
  field: string
  format: (value: unknown) => string
  parse: (text: string) => FieldWrite | undefined
}

/** 設定ページに出す欄の種類。 */
export type SettingsField =
  | { key: 'mode'; kind: 'mode' }
  | { key: SettingsKey; kind: 'integer'; min: number }
  | { key: SettingsKey; kind: 'boolean' }

/** 設定ページに出す欄(`CONFIG_KEYS` のうち live のもの。並びも同じ)。 */
export const SETTINGS_FIELDS: readonly SettingsField[] = CONFIG_KEYS.flatMap((spec): SettingsField[] => {
  switch (spec.kind) {
    case 'mode':
      return [{ key: 'mode', kind: 'mode' }]
    case 'integer':
      return [{ key: spec.key, kind: 'integer', min: spec.min }]
    case 'boolean':
      return [{ key: spec.key, kind: 'boolean' }]
    case 'string':
      return [] // stateFile は設定ページでは変えない(状態ファイルの読み直しが要る)
  }
})

/**
 * 整数の欄。空欄は既定値に戻す(clear)。下限以上の整数だけを受け付ける。
 * 前後の空白は無視する。`1e2` や `0x10` のような書き方は受け付けない(10 進の数字だけ)。
 */
export function integerField(field: string, min: number): FieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (!/^[+-]?\d+$/.test(trimmed)) return undefined
      const value = Number(trimmed)
      return Number.isSafeInteger(value) && value >= min ? { kind: 'set', value } : undefined
    },
  }
}

/** on/off の欄。スイッチが `'true'` / `'false'` を入れる。 */
export function booleanField(field: string): FieldSpec {
  return {
    field,
    format: (value) => (value === true ? 'true' : value === false ? 'false' : ''),
    parse: (text) => {
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      return text === '' ? { kind: 'clear' } : undefined
    },
  }
}

/** モードの欄。選択肢(block / archive / both / off)のどれか。 */
export function modeField(field: string): FieldSpec {
  return {
    field,
    format: (value) => (isMode(value) ? value : ''),
    parse: (text) => (text === '' ? { kind: 'clear' } : isMode(text) ? { kind: 'set', value: text } : undefined),
  }
}

/** 設定ページの全欄の変換。 */
export function fieldSpecs(): FieldSpec[] {
  return SETTINGS_FIELDS.map((field) => {
    switch (field.kind) {
      case 'mode':
        return modeField(field.key)
      case 'integer':
        return integerField(field.key, field.min)
      case 'boolean':
        return booleanField(field.key)
    }
  })
}
