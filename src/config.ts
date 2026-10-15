export interface Config {
  idleMinutes: number
  unlockTtlMinutes: number
  dryRun: boolean
}

export const DEFAULTS: Config = {
  idleMinutes: 60,
  unlockTtlMinutes: 10,
  dryRun: false,
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULTS))

function readInteger(raw: Record<string, unknown>, key: string, min: number): number {
  const value = raw[key]
  if (typeof value !== 'number') {
    throw new Error(`設定 ${key} は数値で指定してください`)
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`設定 ${key} は有限の整数で指定してください`)
  }
  if (value < min) {
    throw new Error(`設定 ${key} は ${min} 以上で指定してください`)
  }
  return value
}

function readBoolean(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key]
  if (typeof value !== 'boolean') {
    throw new Error(`設定 ${key} は boolean で指定してください`)
  }
  return value
}

/**
 * 生の設定値を検証し、既定値で補完した Config を返す。
 * - undefined / null / {} はすべて既定値。
 * - 部分指定は既定値で補完する。
 * - 未知のキーは無視せず例外にする(設定ミスを握りつぶさない)。旧方式のキーも未知として弾く。
 * - 型不正・非整数・非有限・範囲外は Error を投げる。
 */
export function parseConfig(raw: unknown): Config {
  if (raw === undefined || raw === null) {
    return { ...DEFAULTS }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('設定はオブジェクトで指定してください')
  }

  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`設定に未知のキーがあります: ${key}`)
    }
  }

  const config: Config = { ...DEFAULTS }

  if (obj.idleMinutes !== undefined) {
    config.idleMinutes = readInteger(obj, 'idleMinutes', 1)
  }
  if (obj.unlockTtlMinutes !== undefined) {
    config.unlockTtlMinutes = readInteger(obj, 'unlockTtlMinutes', 1)
  }
  if (obj.dryRun !== undefined) {
    config.dryRun = readBoolean(obj, 'dryRun')
  }

  return config
}
