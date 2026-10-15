/**
 * 1 サイクルの実行 (spec §4・§5・§8)。
 * 副作用は CycleDeps の注入点に限定し、判定は decide.ts / diff-unarchive.ts の
 * 純粋関数に委ねる。設定 (ArchiveSettings) とメモリ (CycleMemory) は値で受け取り、
 * config.ts / state.ts には依存しない。入力を変更せず、新しいオブジェクトを返す。
 */
import { decideArchive, type SessionInfo } from './decide.ts'
import { detectUnarchived, pruneUnarchived, recordUnarchived } from './diff-unarchive.ts'

export interface CycleLogger {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
}

export interface CycleDeps {
  now(): number
  listSessions(): Promise<readonly SessionInfo[]>
  archivedIds(): readonly string[]
  archive(id: string): Promise<void>
  isActiveError(error: unknown): boolean
  log: CycleLogger
}

/** 1 サイクル分のアーカイブ設定 (spec §4・§6 の該当キー)。 */
export interface ArchiveSettings {
  thresholdMinutes: number
  skipPinned: boolean
  archiveExisting: boolean
  maxPerCycle: number
  dryRun: boolean
}

/** サイクル間で持ち回るメモリ (永続状態のうち判定に必要な分)。 */
export interface CycleMemory {
  baselineAt: number
  unarchivedAt: Readonly<Record<string, number>>
  prevArchived: ReadonlySet<string> | undefined
}

export interface CycleResult {
  unarchivedAt: Record<string, number>
  prevArchived: ReadonlySet<string>
  archived: string[]
  skippedActive: string[]
  failed: string[]
  dryRunTargets: string[]
  unarchivedChanged: boolean
}

/** 解除記録を保持する期間 (spec §7: 7 日)。 */
export const UNARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** unarchivedAt のキー集合が等しいか (prune による削除の検出に使う)。 */
function sameKeySet(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!(key in b)) return false
  }
  return true
}

/** 例外からログ用のメッセージを取り出す (Error 以外も文字列化する)。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 1 サイクル分の処理を実行する。処理順:
 * 1. now と現在のアーカイブ済み id を取得する。
 * 2. 前回スナップショットとの差分から手動解除を検出し、あれば unarchivedAt を更新する。
 * 3. セッション一覧を取得する (取得の例外は伝播させる)。
 * 4. decideArchive でアーカイブ対象 id を得る。
 * 5. 先頭 maxPerCycle 件だけを処理対象にする。
 * 6. dryRun なら archive を呼ばず dryRunTargets に入れて info ログを出す。
 * 7. 直列に archive する。実行中 (isActiveError) は skippedActive、その他の失敗は failed として継続する。
 * 8. 戻り値の prevArchived には今回成功した id を加え、自分のアーカイブを解除と誤検出しない。
 * 9. pruneUnarchived で古い記録と未知の id を掃除し、変化の有無を返す。
 */
export async function runCycle(
  deps: CycleDeps,
  settings: ArchiveSettings,
  memory: CycleMemory,
): Promise<CycleResult> {
  // 1. 現在時刻とアーカイブ済み id
  const now = deps.now()
  const archivedNow = deps.archivedIds()

  // 2. 手動解除の検出と記録
  const unarchivedIds = detectUnarchived(memory.prevArchived, archivedNow)
  let unarchivedAt: Readonly<Record<string, number>> = memory.unarchivedAt
  if (unarchivedIds.length > 0) {
    unarchivedAt = recordUnarchived(memory.unarchivedAt, unarchivedIds, now)
    deps.log.info(`手動解除を検出しました: ${unarchivedIds.join(', ')}`)
  }
  const recordedUnarchived = unarchivedIds.length > 0

  // 3. セッション一覧 (取得の例外は握りつぶさず伝播させる)
  const sessions = await deps.listSessions()

  // 4. アーカイブ対象の判定
  const targets = decideArchive({
    sessions,
    now,
    baselineAt: memory.baselineAt,
    unarchivedAt,
    idleMinutes: settings.thresholdMinutes,
    skipPinned: settings.skipPinned,
    archiveExisting: settings.archiveExisting,
  })

  // 5. 1 サイクルの上限
  const limited = targets.slice(0, settings.maxPerCycle)

  const archived: string[] = []
  const skippedActive: string[] = []
  const failed: string[] = []
  const dryRunTargets: string[] = []

  if (settings.dryRun) {
    // 6. ログのみ。archive は一切呼ばない
    for (const id of limited) {
      dryRunTargets.push(id)
      deps.log.info(`dryRun: アーカイブ対象 ${id}`)
    }
  } else {
    // 7. 直列実行。個別の失敗は隔離して継続する
    for (const id of limited) {
      try {
        await deps.archive(id)
        archived.push(id)
      } catch (error) {
        if (deps.isActiveError(error)) {
          skippedActive.push(id)
          deps.log.debug(`実行中のため見送ります (次回再試行): ${id}`)
        } else {
          failed.push(id)
          deps.log.warn(`アーカイブに失敗しました: ${id}: ${errorMessage(error)}`)
        }
      }
    }
  }

  // 8. 自分のアーカイブを次回の解除と誤検出しないため、成功分を加えたスナップショットを返す
  const prevArchived = new Set(archivedNow)
  for (const id of archived) {
    prevArchived.add(id)
  }

  // 9. 不要な解除記録を掃除して返す
  const knownIds = new Set(sessions.map((session) => session.id))
  const pruned = pruneUnarchived(unarchivedAt, now, UNARCHIVE_RETENTION_MS, knownIds)
  const unarchivedChanged = recordedUnarchived || !sameKeySet(unarchivedAt, pruned)

  return {
    unarchivedAt: pruned,
    prevArchived,
    archived,
    skippedActive,
    failed,
    dryRunTargets,
    unarchivedChanged,
  }
}
