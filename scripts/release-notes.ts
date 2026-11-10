/**
 * GitHub が自動生成したリリースノートから、作者の @メンションと PR の URL を除く。
 *
 * 目的:
 *   自動生成の各行は `* <タイトル> by @<作者> in https://github.com/<owner>/<repo>/pull/<番号>` で、
 *   作者の @メンションは要らない。PR は `(#<番号>)` と書けば GitHub が同じ PR にリンクする。
 *   `## New Contributors` 節も @メンションと PR URL だけなので丸ごと除く。
 *
 * 使い方:
 *   gh api repos/<owner>/<repo>/releases/generate-notes -f tag_name=<タグ> --jq .body | node scripts/release-notes.ts
 *
 * 変換: PR 行を `* <タイトル> (#<番号>)` にし、New Contributors 節を除き、ほかの行はそのまま出す。
 */
import { text } from 'node:stream/consumers'
import { pathToFileURL } from 'node:url'

const PR_LINE = /^\* (.+) by @\S+ in https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)$/gm

export function tidyReleaseNotes(body: string): string {
  const rewritten = body.replace(PR_LINE, '* $1 (#$2)')
  const withoutContributors = stripNewContributors(rewritten)
  if (withoutContributors === rewritten) {
    return withoutContributors
  }
  return withoutContributors.replace(/\n{3,}/g, '\n\n')
}

function stripNewContributors(body: string): string {
  const lines = body.split('\n')
  const out: string[] = []
  let skip = false
  for (const line of lines) {
    if (/^## New Contributors\s*$/.test(line)) {
      skip = true
      continue
    }
    if (skip) {
      if (/^## /.test(line) || /^\*\*Full Changelog\*\*/.test(line)) {
        skip = false
        out.push(line)
      }
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(tidyReleaseNotes(await text(process.stdin)))
}
