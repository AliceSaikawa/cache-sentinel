/**
 * ログ mtime インデックス (spike U2)。
 * 最終イベント時刻は永続化 API から取れないため、セッションログファイルの mtime を使う。
 * `scanLogMtimes` は `<sessionsRoot>/<projectDir>/<sessionDir>/` を走査し、
 * sessionDir 名 (DSH の `encodeSegment(id)`) を `decodeSegment` した id をキーに、
 * `session.v<N>.jsonl[.zstd]` の mtimeMs の最大値を返す。
 * 純粋関数 `decodeSegment` と副作用 `scanLogMtimes` を分ける。
 * ファイル操作は node:fs/promises と node:path のみを使う。
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** `readdir(withFileTypes)` のエントリのうち、判定に使う部分だけを表す。 */
interface DirEntry {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

/** ログファイル名 (`session.lock` や `*.tmp` は一致しない)。 */
const LOG_FILENAME = /^session\.v\d+\.jsonl(\.zstd)?$/

/** encodeSegment が生成するエスケープ (`~` + 大文字16進4桁)。 */
const ENCODED_CODE_UNIT = /~([0-9A-F]{4})/g

/**
 * DSH の `encodeSegment` の逆変換 (spike V1)。
 * `~XXXX` (大文字16進4桁) を対応する UTF-16 コードユニット文字に戻す。
 * それ以外はそのまま残す。UUID 形式の id はエスケープを含まないため恒等になる。
 */
export function decodeSegment(name: string): string {
  return name.replace(ENCODED_CODE_UNIT, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
}

/** ディレクトリを読む。存在しない・読めない場合は undefined を返す (例外を投げない)。 */
async function readEntries(path: string): Promise<DirEntry[] | undefined> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return undefined
  }
}

/**
 * セッション id → ログ mtimeMs の最大値のインデックスを作る (spike U2)。
 * - ディレクトリ以外のエントリは無視する。
 * - `session.v<N>.jsonl` / `session.v<N>.jsonl.zstd` のみを対象にする。
 * - 同じ id が複数の projectDir にあれば mtimeMs の最大値を採る。
 * - sessionsRoot が存在しない・読めない場合は空の Map。
 * - 途中で消えたファイル・ディレクトリ (ENOENT) や読めないエントリはそのエントリだけ飛ばして継続し、例外を投げない。
 */
export async function scanLogMtimes(sessionsRoot: string): Promise<Map<string, number>> {
  const index = new Map<string, number>()

  const projectDirs = await readEntries(sessionsRoot)
  if (projectDirs === undefined) {
    return index
  }

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue
    const projectPath = join(sessionsRoot, projectDir.name)

    const sessionDirs = await readEntries(projectPath)
    if (sessionDirs === undefined) continue

    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue
      const id = decodeSegment(sessionDir.name)
      const sessionPath = join(projectPath, sessionDir.name)

      const files = await readEntries(sessionPath)
      if (files === undefined) continue

      for (const file of files) {
        if (!file.isFile() || !LOG_FILENAME.test(file.name)) continue

        let mtimeMs: number
        try {
          mtimeMs = (await stat(join(sessionPath, file.name))).mtimeMs
        } catch {
          continue
        }

        const prev = index.get(id)
        if (prev === undefined || mtimeMs > prev) {
          index.set(id, mtimeMs)
        }
      }
    }
  }

  return index
}
