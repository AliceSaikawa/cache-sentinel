/**
 * モード判定と `/sentinel` コマンドの解析・文面 (spec v0.4 §A, §B)。
 * DSH には依存しない純粋関数だけを置く。
 */

import { isMode, type Mode } from './modes.ts'

/** モードがどこから来たか。`command` = state.json の `/sentinel` 設定、`config` = YAML。 */
export type ModeSource = 'command' | 'config'

/**
 * 実効モードを決める(spec §A)。
 * state.json の `mode`(stateMode)があればそれを `command` として使い、
 * なければ YAML の `mode`(configMode)を `config` として使う。
 */
export function effectiveMode(
  stateMode: Mode | undefined,
  configMode: Mode,
): { mode: Mode; source: ModeSource } {
  if (stateMode !== undefined) {
    return { mode: stateMode, source: 'command' }
  }
  return { mode: configMode, source: 'config' }
}

/** 入力禁止のゲートが働くモードか(spec §A: block / both)。 */
export function blocks(mode: Mode): boolean {
  return mode === 'block' || mode === 'both'
}

/** アーカイブのサイクルが働くモードか(spec §A: archive / both)。 */
export function archives(mode: Mode): boolean {
  return mode === 'archive' || mode === 'both'
}

/**
 * アーカイブのしきい値(分)を返す(spec §A / archive-spec v0.4)。
 * - `archive` → `idleMinutes`
 * - `both` → `archiveAfterMinutes`
 * - それ以外 → undefined(アーカイブしない)
 */
export function archiveThresholdMinutes(
  mode: Mode,
  cfg: { idleMinutes: number; archiveAfterMinutes: number },
): number | undefined {
  switch (mode) {
    case 'archive':
      return cfg.idleMinutes
    case 'both':
      return cfg.archiveAfterMinutes
    default:
      return undefined
  }
}

/** `/sentinel` の引数を解析した結果(spec §B)。 */
export type SentinelCommand =
  | { kind: 'status' }
  | { kind: 'set'; mode: Mode }
  | { kind: 'default' }
  | { kind: 'invalid'; input: string }

/**
 * `/sentinel` の引数を解析する(spec §B)。
 * 前後の空白を除き小文字化してから判定する。
 * - 空 → 状態表示
 * - `default` → YAML の値に戻す
 * - モード名 → そのモードに変更
 * - それ以外(空白を含む複数語も)→ invalid。`input` は trim しただけの元の文字列。
 */
export function parseSentinelArgs(rawInput: string): SentinelCommand {
  const trimmed = rawInput.trim()
  const normalized = trimmed.toLowerCase()

  if (normalized === '') {
    return { kind: 'status' }
  }
  if (normalized === 'default') {
    return { kind: 'default' }
  }
  if (isMode(normalized)) {
    return { kind: 'set', mode: normalized }
  }
  return { kind: 'invalid', input: trimmed }
}

/** `/sentinel`(引数なし)の状態表示に必要な入力(spec §B)。 */
export interface StatusInput {
  mode: Mode
  source: ModeSource
  configMode: Mode
  idleMinutes: number
  archiveAfterMinutes: number
  unlockTtlMinutes: number
  dryRun: boolean
  sessionIdleMinutes: number | undefined
}

/** 1 行目: 実効モードとその出どころ。 */
function modeLine(s: StatusInput): string {
  const sourceText =
    s.source === 'command'
      ? `/sentinel で設定、YAML の既定は ${s.configMode}`
      : 'YAML の設定'
  return `cache-sentinel: モード ${s.mode}(${sourceText})`
}

/** 2 行目: モードごとの説明。 */
function modeDescription(s: StatusInput): string {
  switch (s.mode) {
    case 'block':
      return `最終応答から ${s.idleMinutes} 分で入力禁止(/unlock で解除、${s.unlockTtlMinutes} 分有効)`
    case 'archive':
      return `最終応答から ${s.idleMinutes} 分でアーカイブ`
    case 'both':
      return `${s.idleMinutes} 分で入力禁止、${s.archiveAfterMinutes} 分でアーカイブ`
    case 'off':
      return '停止中(何もしません)'
  }
}

/** 3 行目: このセッションの最終応答からの経過。 */
function sessionLine(s: StatusInput): string {
  if (s.sessionIdleMinutes === undefined) {
    return 'このセッション: まだモデル応答がありません'
  }
  return `このセッション: 最終応答から ${s.sessionIdleMinutes} 分`
}

/** `/sentinel`(引数なし)の状態表示の文面(spec §B)。 */
export function statusMessage(s: StatusInput): string {
  const lines = [modeLine(s), modeDescription(s), sessionLine(s)]
  if (s.dryRun) {
    lines.push('dryRun: ブロックもアーカイブもせずログのみ')
  }
  return lines.join('\n')
}

/** `/sentinel` の使い方の文面(spec §B)。 */
export function usageMessage(): string {
  return '使い方: /sentinel [block|archive|both|off|default](引数なしで状態表示)'
}

/** 入力禁止が働かないモードで `/unlock` を打ったときの文面(spec §A)。 */
export function unlockInactiveMessage(mode: Mode): string {
  return `入力禁止は無効です(モード: ${mode})`
}
