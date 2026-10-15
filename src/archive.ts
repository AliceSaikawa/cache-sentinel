/**
 * アーカイブ(archive / both モード)の DSH 接続部。判定と 1 サイクルは decide.ts / cycle.ts に任せ、
 * ここでは workspaceRegistry・sessionPersistence・sessions からサイクルの依存を組み立てる。
 * 仕様は docs/archive-spec.md(v0.2、v0.4 で復活)。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CycleDeps, CycleLogger } from './cycle.ts'
import type { SessionInfo } from './decide.ts'

/** アーカイブに使う ctx のサービス。 */
export interface ArchiveServices {
  workspaceRegistry: {
    readonly archivedSessionIds: readonly string[]
    readonly pinnedSessionIds: readonly string[]
    archiveSession(sessionId: string): Promise<void>
  }
  sessionPersistence: {
    list(): Promise<
      readonly {
        header: { id: string; createdAt: number; origin?: 'subagent'; parentSession?: string }
      }[]
    >
  }
  sessions: {
    get(id: string): { ownEvents(): readonly { time: number }[] } | undefined
  }
}

/** DSH のホームディレクトリ ($DSH_HOME、なければ ~/.dsh)。dsh-home-paths の resolveDshHome と同じ規則。 */
export function resolveHome(env: Record<string, string | undefined> = process.env): string {
  const override = env.DSH_HOME?.trim()
  return override ? override : join(homedir(), '.dsh')
}

/**
 * archiveSession が「実行中の作業あり」で拒否したときのエラーか。
 * DSH を import できない(依存ではない)ため、クラス名と形で判定する。
 */
export function isActiveSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.constructor?.name === 'WorkspaceActiveSessionError') return true
  const shaped = error as Error & { sessionId?: unknown; activity?: unknown }
  return typeof shaped.sessionId === 'string' && Array.isArray(shaped.activity)
}

/** ロード済みセッションの末尾イベント時刻。なければ undefined。 */
function liveLastEventTime(services: ArchiveServices, id: string): number | undefined {
  const events = services.sessions.get(id)?.ownEvents()
  if (events === undefined || events.length === 0) return undefined
  const time = events[events.length - 1]?.time
  return typeof time === 'number' && Number.isFinite(time) ? time : undefined
}

/** サービスと mtime 走査関数から CycleDeps を組み立てる。 */
export function createDeps(
  services: ArchiveServices,
  scan: () => Promise<Map<string, number>>,
  log: CycleLogger,
  now: () => number = Date.now,
): CycleDeps {
  return {
    now,
    archivedIds: () => services.workspaceRegistry.archivedSessionIds,
    archive: (id) => services.workspaceRegistry.archiveSession(id),
    isActiveError: isActiveSessionError,
    log,
    async listSessions(): Promise<readonly SessionInfo[]> {
      const [snapshots, mtimes] = await Promise.all([services.sessionPersistence.list(), scan()])
      const archived = new Set(services.workspaceRegistry.archivedSessionIds)
      const pinned = new Set(services.workspaceRegistry.pinnedSessionIds)
      return snapshots.map(({ header }): SessionInfo => {
        const candidates = [mtimes.get(header.id), liveLastEventTime(services, header.id)].filter(
          (value): value is number => value !== undefined,
        )
        const info: SessionInfo = {
          id: header.id,
          createdAt: header.createdAt,
          pinned: pinned.has(header.id),
          archived: archived.has(header.id),
        }
        if (candidates.length > 0) info.lastActivityAt = Math.max(...candidates)
        if (header.origin !== undefined) info.origin = header.origin
        if (header.parentSession !== undefined) info.parentSession = header.parentSession
        return info
      })
    },
  }
}
