import type { Locale } from './i18n.ts'
import { MESSAGES, type Messages } from './messages.ts'
import { isMode, MODES, type Mode } from './modes.ts'

/** プラグイン設定 (spec v0.4 §6)。全モード分を 1 つに統合したもの。 */
export interface Config {
  mode: Mode
  idleMinutes: number
  archiveAfterMinutes: number
  unlockTtlMinutes: number
  checkIntervalSeconds: number
  skipPinned: boolean
  archiveExisting: boolean
  maxPerCycle: number
  dryRun: boolean
  stateFile?: string
}

export const DEFAULTS: Required<Omit<Config, 'stateFile'>> = {
  mode: 'block',
  idleMinutes: 60,
  archiveAfterMinutes: 1440,
  unlockTtlMinutes: 10,
  checkIntervalSeconds: 60,
  skipPinned: true,
  archiveExisting: false,
  maxPerCycle: 20,
  dryRun: false,
}

/** 整数の設定キー。 */
export type IntegerKey = 'idleMinutes' | 'archiveAfterMinutes' | 'unlockTtlMinutes' | 'checkIntervalSeconds' | 'maxPerCycle'
/** boolean の設定キー。 */
export type BooleanKey = 'skipPinned' | 'archiveExisting' | 'dryRun'

/**
 * 設定キー 1 つの仕様 (spec §6)。`parseConfig` と設定画面用スキーマ(`buildConfigSchema`)は
 * どちらもこの表だけを見る(#10。二重管理しない)。既定値は `DEFAULTS` にある。
 * - `live`: 設定画面から変えられ、保存するとプラグインを読み込み直さずに反映するキー
 *   (スキーマで `.volatile()` にする。docs/spike.md「設定スキーマ」S2・S4)。
 *   `stateFile` は状態ファイルの読み直しが要るので live にしない(YAML だけで変える。変えると再読み込み)。
 */
export type ConfigKeySpec =
  | { readonly key: 'mode'; readonly kind: 'mode'; readonly live: true }
  | { readonly key: IntegerKey; readonly kind: 'integer'; readonly min: number; readonly live: true }
  | { readonly key: BooleanKey; readonly kind: 'boolean'; readonly live: true }
  | { readonly key: 'stateFile'; readonly kind: 'string'; readonly live: false }

/** 設定キーの一覧 (spec §6)。並びは検証の順序と設定画面の並び順。 */
export const CONFIG_KEYS: readonly ConfigKeySpec[] = [
  { key: 'mode', kind: 'mode', live: true },
  { key: 'idleMinutes', kind: 'integer', min: 1, live: true },
  { key: 'archiveAfterMinutes', kind: 'integer', min: 1, live: true },
  { key: 'unlockTtlMinutes', kind: 'integer', min: 1, live: true },
  { key: 'checkIntervalSeconds', kind: 'integer', min: 10, live: true },
  { key: 'skipPinned', kind: 'boolean', live: true },
  { key: 'archiveExisting', kind: 'boolean', live: true },
  { key: 'maxPerCycle', kind: 'integer', min: 1, live: true },
  { key: 'dryRun', kind: 'boolean', live: true },
  { key: 'stateFile', kind: 'string', live: false },
]

/** stateFile は既定値を持たない(未指定なら呼び出し側が場所を決める)。 */
const KNOWN_KEYS: ReadonlySet<string> = new Set(CONFIG_KEYS.map((spec) => spec.key))

function readInteger(raw: Record<string, unknown>, key: string, min: number, m: Messages): number {
  const value = raw[key]
  if (typeof value !== 'number') {
    throw new Error(m.configNotNumber(key))
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(m.configNotInteger(key))
  }
  if (value < min) {
    throw new Error(m.configBelowMinimum(key, min))
  }
  return value
}

function readBoolean(raw: Record<string, unknown>, key: string, m: Messages): boolean {
  const value = raw[key]
  if (typeof value !== 'boolean') {
    throw new Error(m.configNotBoolean(key))
  }
  return value
}

function readString(raw: Record<string, unknown>, key: string, m: Messages): string {
  const value = raw[key]
  if (typeof value !== 'string') {
    throw new Error(m.configNotString(key))
  }
  return value
}

function readMode(raw: Record<string, unknown>, m: Messages): Mode {
  const value = raw.mode
  if (!isMode(value)) {
    throw new Error(m.configInvalidMode(MODES.join(' / ')))
  }
  return value
}

/**
 * 生の設定値を検証し、既定値で補完した Config を返す。
 * - undefined / null / {} はすべて既定値。
 * - 部分指定は既定値で補完する。
 * - 未知のキーは無視せず例外にする(設定ミスを握りつぶさない)。
 * - 型不正・非整数・非有限・範囲外はキー名を含む Error を投げる。
 * - mode は MODES 以外なら使える値を列挙した Error を投げる。
 * - stateFile は文字列のみ。未指定なら返り値に含めない(stateFile?: string)。
 * - エラーの文面は `locale` の表示言語 (spec-ui v0.5 §F) で作る。
 */
export function parseConfig(raw: unknown, locale: Locale): Config {
  if (raw === undefined || raw === null) {
    return { ...DEFAULTS }
  }
  const m = MESSAGES[locale]
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(m.configNotObject)
  }

  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(m.configUnknownKey(key))
    }
  }

  const config: Config = { ...DEFAULTS }

  for (const spec of CONFIG_KEYS) {
    if (obj[spec.key] === undefined) continue
    switch (spec.kind) {
      case 'mode':
        config.mode = readMode(obj, m)
        break
      case 'integer':
        config[spec.key] = readInteger(obj, spec.key, spec.min, m)
        break
      case 'boolean':
        config[spec.key] = readBoolean(obj, spec.key, m)
        break
      case 'string':
        config.stateFile = readString(obj, spec.key, m)
        break
    }
  }

  return config
}

/**
 * DSH が `apply` に渡す設定を、ふつうの値のオブジェクトに戻す (純粋関数)。
 * スキーマで `.volatile()` にしたキーは、値ではなく `get()` で今の値を返す参照
 * (`@deepseek-ai/cosmokit` の `Volatile`)として渡される(docs/spike.md S3)。
 * 設定の値はすべてプリミティブなので、`get` 関数を持つオブジェクトを参照とみなして中身に置き換える。
 * オブジェクト以外(undefined など)はそのまま返し、検証は `parseConfig` に任せる。
 */
export function plainConfig(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    result[key] = isVolatileRef(value) ? value.get() : value
  }
  return result
}

function isVolatileRef(value: unknown): value is { get(): unknown } {
  return typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function'
}
