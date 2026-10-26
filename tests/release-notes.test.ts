import assert from 'node:assert/strict'
import test from 'node:test'
import { tidyReleaseNotes } from '../scripts/release-notes.ts'

test('tidyReleaseNotes は PR の行の @メンションと URL を (#番号) にする', () => {
  const body = [
    "## What's Changed",
    '* feat: 対応する DSH の範囲を 0.2.1-rc.3 まで広げる by @AliceSaikawa in https://github.com/AliceSaikawa/cache-sentinel/pull/48',
    '* chore: 0.6.0-rc.3 にする by @AliceSaikawa in https://github.com/AliceSaikawa/cache-sentinel/pull/49',
    '',
    '',
    '**Full Changelog**: https://github.com/AliceSaikawa/cache-sentinel/compare/v0.6.0-rc.2...v0.6.0-rc.3',
  ].join('\n')
  assert.equal(
    tidyReleaseNotes(body),
    [
      "## What's Changed",
      '* feat: 対応する DSH の範囲を 0.2.1-rc.3 まで広げる (#48)',
      '* chore: 0.6.0-rc.3 にする (#49)',
      '',
      '',
      '**Full Changelog**: https://github.com/AliceSaikawa/cache-sentinel/compare/v0.6.0-rc.2...v0.6.0-rc.3',
    ].join('\n'),
  )
})

test('tidyReleaseNotes は bot の作者も除き、PR の形でない行は変えない', () => {
  const body = [
    '* chore(deps): bump esbuild by @dependabot[bot] in https://github.com/AliceSaikawa/cache-sentinel/pull/60',
    '* 手で書いた行 by @AliceSaikawa',
    'Thanks @AliceSaikawa in https://github.com/AliceSaikawa/cache-sentinel/pull/61',
  ].join('\n')
  assert.equal(
    tidyReleaseNotes(body),
    [
      '* chore(deps): bump esbuild (#60)',
      '* 手で書いた行 by @AliceSaikawa',
      'Thanks @AliceSaikawa in https://github.com/AliceSaikawa/cache-sentinel/pull/61',
    ].join('\n'),
  )
})
