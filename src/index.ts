/**
 * cache-sentinel — Host half。アイドルが長いセッションを定期的にアーカイブする。
 * 判定は decide.ts、1 サイクルは cycle.ts、永続状態は state.ts に委ね、ここは DSH サービスとの接続だけを行う。
 * DSH 本体は依存ではないため、使うサービスの形は最小限をここに書き写す (docs/spike.md U1)。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { scanLogMtimes } from './activity.ts'
import { parseConfig } from './config.ts'
import { runCycle, type CycleDeps, type CycleLogger, type CycleMemory } from './cycle.ts'
import type { SessionInfo } from './decide.ts'
import { loadState, saveState } from './state.ts'

export const name = 'cache-sentinel'
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessions', 'timer']

/** ctx が提供するサービスのうち、このプラグインが触る部分。 */
export interface HostContext {
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
  interval(callback: () => void, delayMs: number): () => void
  logger: CycleLogger
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
function liveLastEventTime(ctx: HostContext, id: string): number | undefined {
  const events = ctx.sessions.get(id)?.ownEvents()
  if (events === undefined || events.length === 0) return undefined
  const time = events[events.length - 1]?.time
  return typeof time === 'number' && Number.isFinite(time) ? time : undefined
}

/** ctx と mtime 走査関数から CycleDeps を組み立てる。 */
export function createDeps(
  ctx: HostContext,
  scan: () => Promise<Map<string, number>>,
  now: () => number = Date.now,
): CycleDeps {
  return {
    now,
    archivedIds: () => ctx.workspaceRegistry.archivedSessionIds,
    archive: (id) => ctx.workspaceRegistry.archiveSession(id),
    isActiveError: isActiveSessionError,
    log: ctx.logger,
    async listSessions(): Promise<readonly SessionInfo[]> {
      const [snapshots, mtimes] = await Promise.all([ctx.sessionPersistence.list(), scan()])
      const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
      const pinned = new Set(ctx.workspaceRegistry.pinnedSessionIds)
      return snapshots.map(({ header }): SessionInfo => {
        const candidates = [mtimes.get(header.id), liveLastEventTime(ctx, header.id)].filter(
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

export async function apply(ctx: HostContext, rawConfig?: unknown): Promise<void> {
  const config = parseConfig(rawConfig)
  const home = resolveHome()
  const stateFile = config.stateFile ?? join(home, 'cache-sentinel', 'state.json')
  const sessionsRoot = join(home, 'sessions')
  const deps = createDeps(ctx, () => scanLogMtimes(sessionsRoot))

  const initial = await loadState(stateFile, deps.now())
  await saveState(stateFile, initial).catch((error) => {
    ctx.logger.warn(`cache-sentinel: state.json を書けませんでした: ${String(error)}`)
  })
  let memory: CycleMemory = { state: initial, prevArchived: undefined }

  let running = false
  const tick = async (): Promise<void> => {
    if (running) return // 前のサイクルが終わっていなければスキップ (spec §4)
    running = true
    try {
      const result = await runCycle(deps, config, memory)
      memory = { state: result.state, prevArchived: result.prevArchived }
      if (result.stateChanged) {
        await saveState(stateFile, result.state).catch((error) => {
          ctx.logger.warn(`cache-sentinel: state.json の保存に失敗しました: ${String(error)}`)
        })
      }
      if (result.archived.length > 0) {
        ctx.logger.info(`cache-sentinel: ${result.archived.length} 件をアーカイブしました`)
      }
    } catch (error) {
      ctx.logger.warn(`cache-sentinel: サイクルに失敗しました: ${String(error)}`)
    } finally {
      running = false
    }
  }

  ctx.interval(() => void tick(), config.checkIntervalSeconds * 1000)
  ctx.logger.info(
    `cache-sentinel: 開始 (idle ${config.idleMinutes} 分, 間隔 ${config.checkIntervalSeconds} 秒${config.dryRun ? ', dryRun' : ''})`,
  )
  void tick()
}
