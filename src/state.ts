/**
 * 永続状態 (state.json) の読み書き・破損復旧・掃除 (§7)。
 * 純粋関数 (parseState / pruneState) と副作用 (loadState / saveState) を分ける。
 * ファイル操作は node:fs/promises のみを使う。
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'

export interface State {
  version: 1
  baselineAt: number
  unarchivedAt: Record<string, number>
}

/** 手動解除の記録を保持する期間 (§7: 7 日)。 */
export const STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function freshState(now: number): State {
  return { version: 1, baselineAt: now, unarchivedAt: {} }
}

/** 時刻として妥当な値か (非負の有限数)。 */
function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * state.json の内容を解釈する。
 * - undefined / JSON 不正 / version 不一致 / baselineAt 不正 は全体を破損とみなし、
 *   baselineAt = now の新規 State を返す (§7 の安全側)。
 * - unarchivedAt の個別エントリが不正な場合は、そのエントリだけ捨てる。
 */
export function parseState(text: string | undefined, now: number): State {
  if (text === undefined) {
    return freshState(now)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return freshState(now)
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return freshState(now)
  }

  const record = raw as Record<string, unknown>
  if (record.version !== 1) {
    return freshState(now)
  }

  const baselineAt = record.baselineAt
  if (!isNonNegativeFinite(baselineAt)) {
    return freshState(now)
  }

  // unarchivedAt は不正なエントリだけ捨てる。オブジェクトでなければ空として扱う。
  const entries: Array<[string, number]> = []
  const rawUnarchivedAt = record.unarchivedAt
  if (rawUnarchivedAt !== null && typeof rawUnarchivedAt === 'object' && !Array.isArray(rawUnarchivedAt)) {
    for (const [id, at] of Object.entries(rawUnarchivedAt as Record<string, unknown>)) {
      if (isNonNegativeFinite(at)) {
        entries.push([id, at])
      }
    }
  }

  return { version: 1, baselineAt, unarchivedAt: Object.fromEntries(entries) }
}

/**
 * 不要になった解除記録を除いた新しい State を返す (入力を変更しない)。
 * - now - STATE_RETENTION_MS より古い記録を削除する (境界値は残す)。
 * - knownIds が与えられたら、そこに含まれない id も削除する。
 */
export function pruneState(state: State, now: number, knownIds?: ReadonlySet<string>): State {
  const cutoff = now - STATE_RETENTION_MS
  const entries = Object.entries(state.unarchivedAt).filter(([id, at]) => {
    if (at < cutoff) {
      return false
    }
    if (knownIds !== undefined && !knownIds.has(id)) {
      return false
    }
    return true
  })

  return { version: 1, baselineAt: state.baselineAt, unarchivedAt: Object.fromEntries(entries) }
}

/**
 * state.json を読む。ファイル欠落・読み取りエラーは破損として新規 State を返す (§7)。
 * ファイルは作らない。
 */
export async function loadState(path: string, now: number): Promise<State> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return freshState(now)
  }
  return parseState(text, now)
}

/**
 * state.json を atomic に書く (同じディレクトリの一時ファイル → rename)。
 * 親ディレクトリは mkdir -p する。JSON は整形し末尾に改行を付ける。
 */
export async function saveState(path: string, state: State): Promise<void> {
  const dir = parentDir(path)
  await mkdir(dir, { recursive: true })

  const json = `${JSON.stringify(state, null, 2)}\n`
  const tmp = `${dir}/${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`

  await writeFile(tmp, json, 'utf8')
  try {
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

/** POSIX パスの親ディレクトリを返す (node:path を使わない)。 */
function parentDir(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  if (index < 0) {
    return '.'
  }
  if (index === 0) {
    return '/'
  }
  return filePath.slice(0, index)
}

/** POSIX パスのファイル名を返す。 */
function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1)
}
