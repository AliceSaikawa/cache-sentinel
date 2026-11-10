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

test('tidyReleaseNotes は New Contributors 節を除き、bot の作者行も (#番号) にする', () => {
  const body = [
    "## What's Changed",
    '* feat: example by @dependabot[bot] in https://github.com/AliceSaikawa/cache-sentinel/pull/60',
    '',
    '## New Contributors',
    '* @dsh-superagent-hope made their first contribution in https://github.com/AliceSaikawa/cache-sentinel/pull/51',
    '',
    '**Full Changelog**: https://github.com/AliceSaikawa/cache-sentinel/compare/v0.6.0...v0.7.0-rc.1',
  ].join('\n')
  const out = tidyReleaseNotes(body)
  assert.equal(
    out,
    [
      "## What's Changed",
      '* feat: example (#60)',
      '',
      '**Full Changelog**: https://github.com/AliceSaikawa/cache-sentinel/compare/v0.6.0...v0.7.0-rc.1',
    ].join('\n'),
  )
  assert.ok(!out.includes('@'))
  assert.ok(!out.includes('/pull/'))
})

test('tidyReleaseNotes は PR の形でない行は変えない', () => {
  const body = ['* 手で書いた行 by @AliceSaikawa', 'Thanks @AliceSaikawa in https://github.com/AliceSaikawa/cache-sentinel/pull/61'].join(
    '\n',
  )
  assert.equal(
    tidyReleaseNotes(body),
  ['* 手で書いた行 by @AliceSaikawa', 'Thanks @AliceSaikawa in https://github.com/AliceSaikawa/cache-sentinel/pull/61'].join('\n'),
  )
})
