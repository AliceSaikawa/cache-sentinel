import assert from 'node:assert/strict'
import test from 'node:test'

import { detectUnarchived, pruneUnarchived, recordUnarchived } from '../src/diff-unarchive.ts'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000
const RETENTION = 7 * DAY

test('初回 (prev が undefined) は差分比較せず空配列を返す (spec §5)', () => {
  assert.deepEqual(detectUnarchived(undefined, []), [])
  assert.deepEqual(detectUnarchived(undefined, ['a', 'b']), [])
})

test('変化なしなら空配列を返す', () => {
  assert.deepEqual(detectUnarchived(new Set(['a', 'b']), ['a', 'b']), [])
  assert.deepEqual(detectUnarchived(new Set(['b', 'a']), ['a', 'b']), [])
})

test('前回にあって今回ない id を解除として検出する', () => {
  assert.deepEqual(detectUnarchived(new Set(['a', 'b']), ['b']), ['a'])
})

test('複数の解除をすべて検出する', () => {
  assert.deepEqual(detectUnarchived(new Set(['a', 'b', 'c']), ['c']), ['a', 'b'])
})

test('解除は前回の反復順で返す', () => {
  assert.deepEqual(detectUnarchived(new Set(['c', 'a', 'b']), ['c']), ['a', 'b'])
})

test('追加のみ (解除なし) なら空配列を返す', () => {
  assert.deepEqual(detectUnarchived(new Set(['a']), ['a', 'b', 'c']), [])
})

test('current に重複があっても重複した解除を返さない', () => {
  assert.deepEqual(detectUnarchived(new Set(['a', 'b']), ['b', 'b']), ['a'])
})

test('空の prev なら空配列を返す', () => {
  assert.deepEqual(detectUnarchived(new Set(), ['a']), [])
})

test('入力を変更しない', () => {
  const prev = new Set(['a', 'b'])
  const current = ['a', 'c']
  const prevSnapshot = [...prev]
  const currentSnapshot = [...current]

  const result = detectUnarchived(prev, current)

  assert.deepEqual([...prev], prevSnapshot)
  assert.deepEqual([...current], currentSnapshot)
  assert.notEqual(result, prev)
  result.push('mutated')
  assert.deepEqual([...prev], prevSnapshot)
  assert.deepEqual([...current], currentSnapshot)
})

test('recordUnarchived は解除 id を now で記録する', () => {
  assert.deepEqual(recordUnarchived({}, ['a'], NOW), { a: NOW })
})

test('recordUnarchived は既存の記録を保持しつつ上書きする', () => {
  const base = { a: NOW - 1000, b: NOW - 2000 }
  assert.deepEqual(recordUnarchived(base, ['b'], NOW), { a: NOW - 1000, b: NOW })
})

test('recordUnarchived は同じ id の古い解除時刻を新しい時刻で上書きする', () => {
  assert.deepEqual(recordUnarchived({ a: NOW - 600_000 }, ['a'], NOW), { a: NOW })
})

test('recordUnarchived は ids が空でも新しいオブジェクトを返す', () => {
  const base = { a: NOW }
  const result = recordUnarchived(base, [], NOW)
  assert.deepEqual(result, { a: NOW })
  assert.notEqual(result, base)
})

test('recordUnarchived は入力を変更しない', () => {
  const base = { a: NOW - 1000 }
  const ids = ['b', 'c']
  const baseSnapshot = structuredClone(base)
  const idsSnapshot = [...ids]

  const result = recordUnarchived(base, ids, NOW)

  assert.deepEqual(base, baseSnapshot)
  assert.deepEqual(ids, idsSnapshot)
  assert.notEqual(result, base)
  result.d = NOW
  assert.deepEqual(base, baseSnapshot)
  assert.deepEqual(ids, idsSnapshot)
})

// --- pruneUnarchived ---

test('pruneUnarchived は now - at が保持期間を超えた記録を削除する', () => {
  const base = { old: NOW - RETENTION - 1, keep: NOW - RETENTION + 1 }
  assert.deepEqual(pruneUnarchived(base, NOW, RETENTION), { keep: NOW - RETENTION + 1 })
})

test('pruneUnarchived は境界ちょうど (now - at === retentionMs) を残す', () => {
  const base = { boundary: NOW - RETENTION }
  assert.deepEqual(pruneUnarchived(base, NOW, RETENTION), { boundary: NOW - RETENTION })
})

test('pruneUnarchived は knownIds に含まれない id を削除する', () => {
  const base = { alive: NOW - 1000, gone: NOW - 1000 }
  assert.deepEqual(pruneUnarchived(base, NOW, RETENTION, new Set(['alive'])), { alive: NOW - 1000 })
})

test('pruneUnarchived は古さと knownIds の両方で絞る', () => {
  const base = { old: NOW - RETENTION - 1, gone: NOW, alive: NOW }
  assert.deepEqual(pruneUnarchived(base, NOW, RETENTION, new Set(['alive', 'old'])), { alive: NOW })
})

test('pruneUnarchived は knownIds が undefined なら id で絞らない', () => {
  const base = { a: NOW - 1000, b: NOW - 2000 }
  assert.deepEqual(pruneUnarchived(base, NOW, RETENTION), { a: NOW - 1000, b: NOW - 2000 })
})

test('pruneUnarchived は空の記録でも新しいオブジェクトを返す', () => {
  const base: Record<string, number> = {}
  const result = pruneUnarchived(base, NOW, RETENTION)
  assert.deepEqual(result, {})
  assert.notEqual(result, base)
})

test('pruneUnarchived は入力を変更しない', () => {
  const base = { old: NOW - RETENTION - 1, keep: NOW }
  const known = new Set(['old', 'keep'])
  const baseSnapshot = structuredClone(base)
  const knownSnapshot = [...known]

  const result = pruneUnarchived(base, NOW, RETENTION, known)

  assert.deepEqual(base, baseSnapshot)
  assert.deepEqual([...known], knownSnapshot)
  assert.notEqual(result, base)
  result.added = NOW
  assert.deepEqual(base, baseSnapshot)
})
