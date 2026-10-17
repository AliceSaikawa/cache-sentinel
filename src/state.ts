/**
 * 永続状態 (state.json, version 2) の読み書き・破損復旧 (§C)。
 * 純粋関数 (parseState / tempPathFor) と副作用 (loadState / saveState) を分ける。
 * ファイル操作は node:fs/promises と node:path のみを使う。
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { isMode, type Mode } from './modes.ts'

export interface State {
  version: 2
  /** 実効モードの優先値 (§A)。無ければ YAML の `mode` を使う。 */
  mode?: Mode
  /** アーカイブが初めて有効になった時刻 (§B)。無ければ有効化時に記録する。 */
  baselineAt?: number
  /** 手動解除を観測した時刻 (sessionId → epoch ms)。 */
  unarchivedAt: Record<string, number>
}

/** 手動解除の記録を保持する期間 (archive-spec §7: 7 日)。 */
export const STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** 空の状態 (mode なし・baselineAt なし)。 */
export function emptyState(): State {
  return { version: 2, unarchivedAt: {} }
}

/** 時刻として妥当な値か (非負の有限数)。 */
function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** unarchivedAt のエントリのうち、値が非負有限数でないものを捨てる。 */
function parseUnarchivedAt(value: unknown): Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const entries: Array<[string, number]> = []
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (isNonNegativeFinite(at)) {
      entries.push([id, at])
    }
  }
  return Object.fromEntries(entries)
}

/**
 * state.json の内容を解釈する (§C)。
 * - undefined / JSON 不正 / オブジェクトでない / version が 1 でも 2 でもない → 空の状態。
 * - version 1: `baselineAt` は必須なので、非負有限数でなければ空の状態。
 * - version 2: `baselineAt` と `mode` は省略可。不正な項目だけ捨てる。
 * - `unarchivedAt` は v1 / v2 とも、オブジェクトでなければ {}、
 *   値が非負有限数でないエントリだけ捨てる。
 * 結果は常に version 2 で、未設定のキーは含めない。
 */
export function parseState(text: string | undefined): State {
  if (text === undefined) {
    return emptyState()
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return emptyState()
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyState()
  }

  const record = raw as Record<string, unknown>
  const version = record.version
  if (version !== 1 && version !== 2) {
    return emptyState()
  }

  const state = emptyState()

  const baselineAt = record.baselineAt
  const mode = record.mode

  if (version === 1) {
    // v1 は baselineAt 必須。不正なら全体を破損とみなす。
    if (!isNonNegativeFinite(baselineAt)) {
      return emptyState()
    }
    state.baselineAt = baselineAt
  } else {
    // v2 は baselineAt も mode も省略可。不正な項目だけ捨てる。
    if (isNonNegativeFinite(baselineAt)) {
      state.baselineAt = baselineAt
    }
    if (isMode(mode)) {
      state.mode = mode
    }
  }

  state.unarchivedAt = parseUnarchivedAt(record.unarchivedAt)
  return state
}

/**
 * state.json を読む。ファイル欠落・読み取りエラーは空の状態として扱う (§C)。
 * ファイルは作らない。
 */
export async function loadState(filePath: string): Promise<State> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    return emptyState()
  }
  return parseState(text)
}

/**
 * 保存先と同じディレクトリの一時ファイルのパスを返す (純粋関数)。
 * `p` に `node:path` の `win32` / `posix` を渡すと、その OS の区切り文字で計算する。
 * 既定は実行環境の OS に従う `node:path`。
 * 例: `p = path.win32` で `C:\Users\u\.dsh\cache-sentinel\state.json` を渡すと
 * `C:\Users\u\.dsh\cache-sentinel\state.json.<unique>.tmp` になる。
 */
export function tempPathFor(target: string, unique: string, p: typeof path = path): string {
  return `${p.join(p.dirname(target), p.basename(target))}.${unique}.tmp`
}

/**
 * state.json を atomic に書く (同じディレクトリの一時ファイル → rename)。
 * 親ディレクトリは mkdir -p する。JSON は整形し末尾に改行を付ける。
 * rename に失敗したら一時ファイルを消して例外を伝える。
 */
export async function saveState(filePath: string, state: State): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })

  const json = `${JSON.stringify(state, null, 2)}\n`
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  const tmp = tempPathFor(filePath, unique)

  await writeFile(tmp, json, 'utf8')
  try {
    await rename(tmp, filePath)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}
