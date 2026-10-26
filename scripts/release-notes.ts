/**
 * GitHub が自動生成したリリースノートから、作者の @メンションと PR の URL を除く。
 *
 * 目的:
 *   自動生成の各行は `* <タイトル> by @<作者> in https://github.com/<owner>/<repo>/pull/<番号>` で、
 *   作者の @メンションは要らない。PR は `(#<番号>)` と書けば GitHub が同じ PR にリンクする。
 *
 * 使い方:
 *   gh api repos/<owner>/<repo>/releases/generate-notes -f tag_name=<タグ> --jq .body | node scripts/release-notes.ts
 *
 * 変換: 上の形の行だけを `* <タイトル> (#<番号>)` にし、ほかの行はそのまま出す。
 */
import { text } from 'node:stream/consumers'
import { pathToFileURL } from 'node:url'

const PR_LINE = /^\* (.+) by @\S+ in https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)$/gm

export function tidyReleaseNotes(body: string): string {
  return body.replace(PR_LINE, '* $1 (#$2)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(tidyReleaseNotes(await text(process.stdin)))
}
