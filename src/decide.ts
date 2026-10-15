/**
 * archive 対象セッションの判定 (spec §3 の 1〜5 と §8)。
 * 純粋関数。入力を変更せず、DSH の API を呼ばない。
 */

export interface SessionInfo {
  id: string
  origin?: 'subagent'
  parentSession?: string
  createdAt: number
  lastActivityAt?: number
  pinned: boolean
  archived: boolean
}

export interface DecideInput {
  sessions: readonly SessionInfo[]
  now: number
  baselineAt: number
  unarchivedAt: Readonly<Record<string, number>>
  idleMinutes: number
  skipPinned: boolean
  archiveExisting: boolean
}

interface Candidate {
  id: string
  idle: number
}

const MS_PER_MINUTE = 60_000

/**
 * アーカイブすべきセッション id を、アイドルの長い順で返す。
 *
 * 対象条件 (すべて満たすもの):
 * 1. トップレベルセッション (`origin !== 'subagent'` かつ `parentSession` なし)
 * 2. 未アーカイブ
 * 3. `skipPinned` のときはピン留めされていない
 * 4. `archiveExisting: false` のときは `effective >= baselineAt`
 * 5. アイドル時間が `idleMinutes` 分を厳密に超える
 *
 * ここで `effective = max(lastActivityAt ?? createdAt, unarchivedAt[id] ?? 0)` (spec §2)。
 * `effective > now` (時計巻き戻り) はアイドル 0 として扱う (spec §8)。
 * 同値のアイドルは入力順を保つ (Array#sort は安定ソート)。
 */
export function decideArchive(input: DecideInput): string[] {
  const { sessions, now, baselineAt, unarchivedAt, idleMinutes, skipPinned, archiveExisting } = input
  const threshold = idleMinutes * MS_PER_MINUTE
  const candidates: Candidate[] = []

  for (const session of sessions) {
    // 1. サブエージェントは親のアーカイブに従う
    if (session.origin === 'subagent') continue
    if (session.parentSession !== undefined) continue
    // 2. アーカイブ済みは対象外
    if (session.archived) continue
    // 3. ピン留め (アーカイブするとピンが外れるため既定で除外)
    if (skipPinned && session.pinned) continue

    const lastActivity = session.lastActivityAt ?? session.createdAt
    const unarchived = unarchivedAt[session.id] ?? 0
    const effective = Math.max(lastActivity, unarchived)

    // §8 時計巻き戻りはアイドル 0
    const idle = effective > now ? 0 : now - effective

    // 4. 基準時刻より前のセッションは既定で対象外
    if (!archiveExisting && effective < baselineAt) continue
    // 5. しきい値の厳密超過のみ対象
    if (!(idle > threshold)) continue

    candidates.push({ id: session.id, idle })
  }

  return candidates.sort((a, b) => b.idle - a.idle).map((candidate) => candidate.id)
}
