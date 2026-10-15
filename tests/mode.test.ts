import assert from 'node:assert/strict'
import test from 'node:test'

import {
  archives,
  archiveThresholdMinutes,
  blocks,
  effectiveMode,
  parseSentinelArgs,
  statusMessage,
  unlockInactiveMessage,
  usageMessage,
  type StatusInput,
} from '../src/mode.ts'

// ---- effectiveMode (spec §A) ----

test('effectiveMode: stateMode があればそれを command として使う', () => {
  assert.deepEqual(effectiveMode('archive', 'block'), {
    mode: 'archive',
    source: 'command',
  })
})

test('effectiveMode: stateMode が undefined なら configMode を config として使う', () => {
  assert.deepEqual(effectiveMode(undefined, 'both'), {
    mode: 'both',
    source: 'config',
  })
})

test('effectiveMode: stateMode が configMode と同じでも command を優先する', () => {
  assert.deepEqual(effectiveMode('off', 'off'), { mode: 'off', source: 'command' })
})

// ---- blocks / archives (spec §A) ----

test('blocks: block と both だけ真', () => {
  assert.equal(blocks('block'), true)
  assert.equal(blocks('both'), true)
  assert.equal(blocks('archive'), false)
  assert.equal(blocks('off'), false)
})

test('archives: archive と both だけ真', () => {
  assert.equal(archives('archive'), true)
  assert.equal(archives('both'), true)
  assert.equal(archives('block'), false)
  assert.equal(archives('off'), false)
})

// ---- archiveThresholdMinutes (spec §A) ----

test('archiveThresholdMinutes: archive は idleMinutes、both は archiveAfterMinutes', () => {
  const cfg = { idleMinutes: 60, archiveAfterMinutes: 1440 }
  assert.equal(archiveThresholdMinutes('archive', cfg), 60)
  assert.equal(archiveThresholdMinutes('both', cfg), 1440)
})

test('archiveThresholdMinutes: block と off は undefined', () => {
  const cfg = { idleMinutes: 60, archiveAfterMinutes: 1440 }
  assert.equal(archiveThresholdMinutes('block', cfg), undefined)
  assert.equal(archiveThresholdMinutes('off', cfg), undefined)
})

// ---- parseSentinelArgs (spec §B) ----

test('parseSentinelArgs: 空文字と空白のみは status', () => {
  assert.deepEqual(parseSentinelArgs(''), { kind: 'status' })
  assert.deepEqual(parseSentinelArgs('   '), { kind: 'status' })
  assert.deepEqual(parseSentinelArgs('\t\n'), { kind: 'status' })
})

test('parseSentinelArgs: default は default(大文字小文字を問わない)', () => {
  assert.deepEqual(parseSentinelArgs('default'), { kind: 'default' })
  assert.deepEqual(parseSentinelArgs('  DEFAULT '), { kind: 'default' })
})

test('parseSentinelArgs: モード名は set(前後の空白を除き小文字化)', () => {
  assert.deepEqual(parseSentinelArgs('block'), { kind: 'set', mode: 'block' })
  assert.deepEqual(parseSentinelArgs('ARCHIVE'), { kind: 'set', mode: 'archive' })
  assert.deepEqual(parseSentinelArgs('  Both '), { kind: 'set', mode: 'both' })
  assert.deepEqual(parseSentinelArgs('off'), { kind: 'set', mode: 'off' })
})

test('parseSentinelArgs: それ以外は invalid で trim 後の元の文字列を返す', () => {
  assert.deepEqual(parseSentinelArgs('xyz'), { kind: 'invalid', input: 'xyz' })
  assert.deepEqual(parseSentinelArgs('  Foo Bar  '), {
    kind: 'invalid',
    input: 'Foo Bar',
  })
})

test('parseSentinelArgs: 空白を含む複数語も invalid', () => {
  assert.deepEqual(parseSentinelArgs('block off'), {
    kind: 'invalid',
    input: 'block off',
  })
  assert.deepEqual(parseSentinelArgs('set block'), {
    kind: 'invalid',
    input: 'set block',
  })
})

test('parseSentinelArgs: モード名に似た別語は invalid', () => {
  assert.deepEqual(parseSentinelArgs('defaults'), {
    kind: 'invalid',
    input: 'defaults',
  })
  assert.deepEqual(parseSentinelArgs('blocking'), {
    kind: 'invalid',
    input: 'blocking',
  })
})

// ---- statusMessage (spec §B) ----

const BASE: StatusInput = {
  mode: 'block',
  source: 'config',
  configMode: 'block',
  idleMinutes: 60,
  archiveAfterMinutes: 1440,
  unlockTtlMinutes: 10,
  dryRun: false,
  sessionIdleMinutes: undefined,
}

test('statusMessage: config の block(応答なし)', () => {
  assert.equal(
    statusMessage(BASE),
    [
      'cache-sentinel: モード block(YAML の設定)',
      '最終応答から 60 分で入力禁止(/unlock で解除、10 分有効)',
      'このセッション: まだモデル応答がありません',
    ].join('\n'),
  )
})

test('statusMessage: command の block は出どころと既定モードを出す', () => {
  assert.equal(
    statusMessage({ ...BASE, mode: 'block', source: 'command', configMode: 'off' }),
    [
      'cache-sentinel: モード block(/sentinel で設定、YAML の既定は off)',
      '最終応答から 60 分で入力禁止(/unlock で解除、10 分有効)',
      'このセッション: まだモデル応答がありません',
    ].join('\n'),
  )
})

test('statusMessage: archive の説明', () => {
  assert.equal(
    statusMessage({ ...BASE, mode: 'archive' }),
    [
      'cache-sentinel: モード archive(YAML の設定)',
      '最終応答から 60 分でアーカイブ',
      'このセッション: まだモデル応答がありません',
    ].join('\n'),
  )
})

test('statusMessage: both の説明は両方のしきい値を出す', () => {
  assert.equal(
    statusMessage({ ...BASE, mode: 'both' }),
    [
      'cache-sentinel: モード both(YAML の設定)',
      '60 分で入力禁止、1440 分でアーカイブ',
      'このセッション: まだモデル応答がありません',
    ].join('\n'),
  )
})

test('statusMessage: off の説明', () => {
  assert.equal(
    statusMessage({ ...BASE, mode: 'off' }),
    [
      'cache-sentinel: モード off(YAML の設定)',
      '停止中(何もしません)',
      'このセッション: まだモデル応答がありません',
    ].join('\n'),
  )
})

test('statusMessage: このセッションの経過分を出す', () => {
  assert.equal(
    statusMessage({ ...BASE, sessionIdleMinutes: 5 }),
    [
      'cache-sentinel: モード block(YAML の設定)',
      '最終応答から 60 分で入力禁止(/unlock で解除、10 分有効)',
      'このセッション: 最終応答から 5 分',
    ].join('\n'),
  )
})

test('statusMessage: 経過 0 分も数値として出す(undefined と区別する)', () => {
  assert.equal(
    statusMessage({ ...BASE, sessionIdleMinutes: 0 }),
    [
      'cache-sentinel: モード block(YAML の設定)',
      '最終応答から 60 分で入力禁止(/unlock で解除、10 分有効)',
      'このセッション: 最終応答から 0 分',
    ].join('\n'),
  )
})

test('statusMessage: dryRun が真なら 4 行目を足す', () => {
  assert.equal(
    statusMessage({ ...BASE, dryRun: true }),
    [
      'cache-sentinel: モード block(YAML の設定)',
      '最終応答から 60 分で入力禁止(/unlock で解除、10 分有効)',
      'このセッション: まだモデル応答がありません',
      'dryRun: ブロックもアーカイブもせずログのみ',
    ].join('\n'),
  )
})

test('statusMessage: dryRun が偽なら 4 行目を足さない', () => {
  assert.equal(statusMessage({ ...BASE, dryRun: false }).split('\n').length, 3)
})

// ---- usageMessage / unlockInactiveMessage ----

test('usageMessage: 使い方の文面', () => {
  assert.equal(
    usageMessage(),
    '使い方: /sentinel [block|archive|both|off|default](引数なしで状態表示)',
  )
})

test('unlockInactiveMessage: モードごとの文面', () => {
  assert.equal(unlockInactiveMessage('off'), '入力禁止は無効です(モード: off)')
  assert.equal(unlockInactiveMessage('archive'), '入力禁止は無効です(モード: archive)')
})
