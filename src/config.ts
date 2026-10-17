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

/** stateFile は既定値を持たない(未指定なら呼び出し側が場所を決める)ので別に足す。 */
const KNOWN_KEYS: ReadonlySet<string> = new Set([...Object.keys(DEFAULTS), 'stateFile'])

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

  if (obj.mode !== undefined) {
    config.mode = readMode(obj, m)
  }
  if (obj.idleMinutes !== undefined) {
    config.idleMinutes = readInteger(obj, 'idleMinutes', 1, m)
  }
  if (obj.archiveAfterMinutes !== undefined) {
    config.archiveAfterMinutes = readInteger(obj, 'archiveAfterMinutes', 1, m)
  }
  if (obj.unlockTtlMinutes !== undefined) {
    config.unlockTtlMinutes = readInteger(obj, 'unlockTtlMinutes', 1, m)
  }
  if (obj.checkIntervalSeconds !== undefined) {
    config.checkIntervalSeconds = readInteger(obj, 'checkIntervalSeconds', 10, m)
  }
  if (obj.skipPinned !== undefined) {
    config.skipPinned = readBoolean(obj, 'skipPinned', m)
  }
  if (obj.archiveExisting !== undefined) {
    config.archiveExisting = readBoolean(obj, 'archiveExisting', m)
  }
  if (obj.maxPerCycle !== undefined) {
    config.maxPerCycle = readInteger(obj, 'maxPerCycle', 1, m)
  }
  if (obj.dryRun !== undefined) {
    config.dryRun = readBoolean(obj, 'dryRun', m)
  }
  if (obj.stateFile !== undefined) {
    config.stateFile = readString(obj, 'stateFile', m)
  }

  return config
}
