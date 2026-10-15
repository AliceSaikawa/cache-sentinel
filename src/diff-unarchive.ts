/**
 * `archivedSessionIds` の差分から手動解除を検出する (spec §5)。
 * 純粋関数。入力を変更せず、DSH の API を呼ばない。
 */

/**
 * 前回スナップショットにあって今回の一覧にない id を、前回の反復順で返す。
 *
 * `prev` が `undefined` のときは初回サイクルなので差分比較せず、空配列を返す
 * (spec §5「起動直後の初回スナップショットは差分比較せず、基線として保存するだけ」)。
 * `current` に重複があっても 1 件として扱う。
 */
export function detectUnarchived(
  prev: ReadonlySet<string> | undefined,
  current: readonly string[],
): string[] {
  if (prev === undefined) return []

  const alive = new Set(current)
  const unarchived: string[] = []
  for (const id of prev) {
    if (!alive.has(id)) unarchived.push(id)
  }
  return unarchived
}

/**
 * `unarchivedAt` のコピーに `ids` を `now` で上書きして返す。
 *
 * 解除時刻は `lastActivityAt` の下限として使われる (spec §2) ため、
 * 同じ id が再度解除されたら新しい時刻で上書きする。
 */
export function recordUnarchived(
  unarchivedAt: Readonly<Record<string, number>>,
  ids: readonly string[],
  now: number,
): Record<string, number> {
  const next: Record<string, number> = { ...unarchivedAt }
  for (const id of ids) {
    next[id] = now
  }
  return next
}
