/**
 * 表示文言のカタログ (spec-ui v0.5 §F)。DSH には依存しない純粋な値だけを置く。
 *
 * 3 言語 `en` / `ja` / `zh-CN` で同じキーと引数を持つことを型で保証する
 * (`Record<Locale, Messages>` にオブジェクトリテラルで代入する)。
 * 日本語は v0.5 までの文言と 1 文字も変えていない。
 */

import type { Locale } from './i18n.ts'

/** 表示言語ごとの文言。同じキーは 3 言語で同じ引数を取る。 */
export interface Messages {
  // --- ブロック通知 (src/notice.ts) ---
  /** 1 行目: 送信を止めた理由。 */
  readonly noticeBlocked: (idleMinutes: number) => string
  /** 2 行目: /unlock の案内。 */
  readonly noticeUnlockHint: string
  /** 破棄された入力の見出し。 */
  readonly noticeDiscarded: string
  /** 出どころの説明文が無い入力の代わりに出す、出どころ名だけの行 (#29)。 */
  readonly noticeInputSource: (kind: string) => string
  /** 入力が上限を超えたときの省略記号。 */
  readonly noticeOmitted: string
  /** テキスト以外の添付があったときの行。 */
  readonly noticeAttachments: (count: number) => string

  // --- 送信前バナー (src/client/banner.ts) ---
  /** unlock ボタンのラベル。 */
  readonly unlockLabel: string
  /** 失効中(経過分あり)の警告。 */
  readonly bannerStale: (idleMinutes: number) => string
  /** 失効中(経過分が不明)の警告。 */
  readonly bannerStaleNoIdle: string
  /** 許可中の情報。 */
  readonly bannerUnlocked: string
  /** 許可中(残り時間あり)の情報。 */
  readonly bannerUnlockedRemaining: (remainingMinutes: number) => string

  // --- /sentinel の出力 (src/mode.ts) ---
  /** 実効モードの行(`/sentinel` で設定)。 */
  readonly modeLineFromCommand: (mode: string, configMode: string) => string
  /** 実効モードの行(YAML の設定)。 */
  readonly modeLineFromConfig: (mode: string) => string
  /** block の説明。 */
  readonly modeBlock: (idleMinutes: number, unlockTtlMinutes: number) => string
  /** archive の説明。 */
  readonly modeArchive: (idleMinutes: number) => string
  /** both の説明。 */
  readonly modeBoth: (idleMinutes: number, archiveAfterMinutes: number) => string
  /** off の説明。 */
  readonly modeOff: string
  /** このセッションの経過(応答なし)。 */
  readonly modeSessionNoResponse: string
  /** このセッションの経過。 */
  readonly modeSession: (sessionIdleMinutes: number) => string
  /** dryRun の行。 */
  readonly modeDryRun: string
  /** `/sentinel` の使い方。 */
  readonly sentinelUsage: string
  /** 入力禁止が無効なモードで `/unlock` を打ったとき。 */
  readonly unlockInactive: (mode: string) => string

  // --- /unlock の出力 (src/unlock.ts) ---
  /** 許可したとき。 */
  readonly unlockGranted: (idleMinutes: number, ttlMinutes: number) => string
  /** まだ失効していないとき。 */
  readonly unlockFresh: (idleMinutes: number) => string
  /** モデル応答がないとき。 */
  readonly unlockNoResponse: string

  // --- 設定エラー (src/config.ts) ---
  /** オブジェクト以外。 */
  readonly configNotObject: string
  /** 未知のキー。 */
  readonly configUnknownKey: (key: string) => string
  /** 数値以外。 */
  readonly configNotNumber: (key: string) => string
  /** 有限の整数以外。 */
  readonly configNotInteger: (key: string) => string
  /** 下限未満。 */
  readonly configBelowMinimum: (key: string, min: number) => string
  /** boolean 以外。 */
  readonly configNotBoolean: (key: string) => string
  /** 文字列以外。 */
  readonly configNotString: (key: string) => string
  /** mode の値が不正。 */
  readonly configInvalidMode: (modes: string) => string

  // --- コマンドの説明 (src/index.ts) ---
  /** `/unlock` の説明。 */
  readonly commandUnlockDescription: string
  /** `/sentinel` の説明。 */
  readonly commandSentinelDescription: string
}

const en: Messages = {
  noticeBlocked: (idleMinutes) =>
    `Send blocked (${idleMinutes} minutes since the last response, as the cache has likely expired).`,
  noticeUnlockHint: 'You can allow the next single send with /unlock.',
  noticeDiscarded: 'Discarded input:',
  noticeInputSource: (kind) => `(input from ${kind})`,
  noticeOmitted: '…(truncated)',
  noticeAttachments: (count) => `(${count} non-text attachments such as images were also discarded)`,

  unlockLabel: 'Allow the next single send (/unlock)',
  bannerStale: (idleMinutes) =>
    `Cache expired (${idleMinutes} minutes since the last response). Sending now will be blocked.`,
  bannerStaleNoIdle: 'Cache expired. Sending now will be blocked.',
  bannerUnlocked: 'Next send allowed (uncached input rates will apply).',
  bannerUnlockedRemaining: (remainingMinutes) =>
    `Next send allowed (uncached input rates will apply). ${remainingMinutes} min left`,

  modeLineFromCommand: (mode, configMode) =>
    `cache-sentinel: mode ${mode} (set with /sentinel, YAML default is ${configMode})`,
  modeLineFromConfig: (mode) => `cache-sentinel: mode ${mode} (from YAML)`,
  modeBlock: (idleMinutes, unlockTtlMinutes) =>
    `Input blocked after ${idleMinutes} minutes since the last response (cleared with /unlock, valid for ${unlockTtlMinutes} minutes)`,
  modeArchive: (idleMinutes) => `Archived after ${idleMinutes} minutes since the last response`,
  modeBoth: (idleMinutes, archiveAfterMinutes) =>
    `Input blocked after ${idleMinutes} minutes, archived after ${archiveAfterMinutes} minutes`,
  modeOff: 'Disabled (does nothing)',
  modeSessionNoResponse: 'This session: no model response yet',
  modeSession: (sessionIdleMinutes) => `This session: ${sessionIdleMinutes} minutes since the last response`,
  modeDryRun: 'dryRun: no blocking or archiving, logging only',
  sentinelUsage: 'Usage: /sentinel [block|archive|both|off|default] (with no argument, show status)',
  unlockInactive: (mode) => `Input blocking is disabled (mode: ${mode})`,

  unlockGranted: (idleMinutes, ttlMinutes) =>
    `Allowed the next send. ${idleMinutes} minutes have passed since the last response, so uncached input rates apply (valid for ${ttlMinutes} minutes)`,
  unlockFresh: (idleMinutes) =>
    `${idleMinutes} minutes since the last response. The cache is still valid, so you can send as is`,
  unlockNoResponse: 'This session has no model response yet',

  configNotObject: 'Config must be an object',
  configUnknownKey: (key) => `Config has an unknown key: ${key}`,
  configNotNumber: (key) => `Config key ${key} must be a number`,
  configNotInteger: (key) => `Config key ${key} must be a finite integer`,
  configBelowMinimum: (key, min) => `Config key ${key} must be at least ${min}`,
  configNotBoolean: (key) => `Config key ${key} must be a boolean`,
  configNotString: (key) => `Config key ${key} must be a string`,
  configInvalidMode: (modes) => `Config key mode must be one of ${modes}`,

  commandUnlockDescription:
    'Allow the next send in a session where sending is blocked because the cache expired (cache-sentinel)',
  commandSentinelDescription:
    'Show cache-sentinel status and switch mode: /sentinel [block|archive|both|off|default]',
}

const ja: Messages = {
  noticeBlocked: (idleMinutes) =>
    `送信を止めました(最終応答から ${idleMinutes} 分。キャッシュが切れている可能性が高いため)。`,
  noticeUnlockHint: '/unlock で次の 1 回を許可できます。',
  noticeDiscarded: '破棄された入力:',
  noticeInputSource: (kind) => `(${kind} からの入力)`,
  noticeOmitted: '…(以下省略)',
  noticeAttachments: (count) => `(画像などテキスト以外の添付 ${count} 件も破棄されました)`,

  unlockLabel: '次の 1 回を許可(/unlock)',
  bannerStale: (idleMinutes) =>
    `キャッシュ切れ(最終応答から ${idleMinutes} 分)。このまま送ると止められます。`,
  bannerStaleNoIdle: 'キャッシュ切れ。このまま送ると止められます。',
  bannerUnlocked: '次の送信を許可中(キャッシュなしの料金になります)。',
  bannerUnlockedRemaining: (remainingMinutes) =>
    `次の送信を許可中(キャッシュなしの料金になります)。あと ${remainingMinutes} 分`,

  modeLineFromCommand: (mode, configMode) =>
    `cache-sentinel: モード ${mode}(/sentinel で設定、YAML の既定は ${configMode})`,
  modeLineFromConfig: (mode) => `cache-sentinel: モード ${mode}(YAML の設定)`,
  modeBlock: (idleMinutes, unlockTtlMinutes) =>
    `最終応答から ${idleMinutes} 分で入力禁止(/unlock で解除、${unlockTtlMinutes} 分有効)`,
  modeArchive: (idleMinutes) => `最終応答から ${idleMinutes} 分でアーカイブ`,
  modeBoth: (idleMinutes, archiveAfterMinutes) =>
    `${idleMinutes} 分で入力禁止、${archiveAfterMinutes} 分でアーカイブ`,
  modeOff: '停止中(何もしません)',
  modeSessionNoResponse: 'このセッション: まだモデル応答がありません',
  modeSession: (sessionIdleMinutes) => `このセッション: 最終応答から ${sessionIdleMinutes} 分`,
  modeDryRun: 'dryRun: ブロックもアーカイブもせずログのみ',
  sentinelUsage: '使い方: /sentinel [block|archive|both|off|default](引数なしで状態表示)',
  unlockInactive: (mode) => `入力禁止は無効です(モード: ${mode})`,

  unlockGranted: (idleMinutes, ttlMinutes) =>
    `次の送信を許可しました。最終応答から ${idleMinutes} 分経過しているため、キャッシュなしの料金になります(許可は ${ttlMinutes} 分有効)`,
  unlockFresh: (idleMinutes) =>
    `最終応答から ${idleMinutes} 分です。キャッシュは有効なのでそのまま送信できます`,
  unlockNoResponse: 'このセッションはまだモデル応答がありません',

  configNotObject: '設定はオブジェクトで指定してください',
  configUnknownKey: (key) => `設定に未知のキーがあります: ${key}`,
  configNotNumber: (key) => `設定 ${key} は数値で指定してください`,
  configNotInteger: (key) => `設定 ${key} は有限の整数で指定してください`,
  configBelowMinimum: (key, min) => `設定 ${key} は ${min} 以上で指定してください`,
  configNotBoolean: (key) => `設定 ${key} は boolean で指定してください`,
  configNotString: (key) => `設定 ${key} は文字列で指定してください`,
  configInvalidMode: (modes) => `設定 mode は ${modes} のいずれかで指定してください`,

  commandUnlockDescription:
    'キャッシュ切れで入力禁止のセッションで、次の送信を許可する(cache-sentinel)',
  commandSentinelDescription:
    'cache-sentinel の状態表示とモード切り替え: /sentinel [block|archive|both|off|default]',
}

const zhCN: Messages = {
  noticeBlocked: (idleMinutes) =>
    `已阻止发送(距最后一次响应 ${idleMinutes} 分钟，因为缓存很可能已过期)。`,
  noticeUnlockHint: '可用 /unlock 允许下 1 次发送。',
  noticeDiscarded: '已丢弃的输入：',
  noticeInputSource: (kind) => `(来自 ${kind} 的输入)`,
  noticeOmitted: '…(以下省略)',
  noticeAttachments: (count) => `(另有 ${count} 条图片等非文本附件被丢弃)`,

  unlockLabel: '允许下 1 次发送(/unlock)',
  bannerStale: (idleMinutes) =>
    `缓存已过期(距最后一次响应 ${idleMinutes} 分钟)。直接发送将被阻止。`,
  bannerStaleNoIdle: '缓存已过期。直接发送将被阻止。',
  bannerUnlocked: '正允许下一次发送(将按无缓存价格计费)。',
  bannerUnlockedRemaining: (remainingMinutes) =>
    `正允许下一次发送(将按无缓存价格计费)。剩余 ${remainingMinutes} 分钟`,

  modeLineFromCommand: (mode, configMode) =>
    `cache-sentinel：模式 ${mode}(通过 /sentinel 设置，YAML 默认为 ${configMode})`,
  modeLineFromConfig: (mode) => `cache-sentinel：模式 ${mode}(YAML 设置)`,
  modeBlock: (idleMinutes, unlockTtlMinutes) =>
    `距最后一次响应 ${idleMinutes} 分钟后禁止输入(用 /unlock 解除，${unlockTtlMinutes} 分钟内有效)`,
  modeArchive: (idleMinutes) => `距最后一次响应 ${idleMinutes} 分钟后归档`,
  modeBoth: (idleMinutes, archiveAfterMinutes) =>
    `${idleMinutes} 分钟后禁止输入，${archiveAfterMinutes} 分钟后归档`,
  modeOff: '已停止(不做任何操作)',
  modeSessionNoResponse: '本会话：尚无模型响应',
  modeSession: (sessionIdleMinutes) => `本会话：距最后一次响应 ${sessionIdleMinutes} 分钟`,
  modeDryRun: 'dryRun：不阻止也不归档，仅记录日志',
  sentinelUsage: '用法：/sentinel [block|archive|both|off|default](不带参数时显示状态)',
  unlockInactive: (mode) => `输入禁止已禁用(模式：${mode})`,

  unlockGranted: (idleMinutes, ttlMinutes) =>
    `已允许下一次发送。距最后一次响应已过 ${idleMinutes} 分钟，因此将按无缓存价格计费(许可 ${ttlMinutes} 分钟内有效)`,
  unlockFresh: (idleMinutes) =>
    `距最后一次响应 ${idleMinutes} 分钟。缓存仍有效，可直接发送`,
  unlockNoResponse: '本会话尚无模型响应',

  configNotObject: '配置必须是对象',
  configUnknownKey: (key) => `配置中有未知的键：${key}`,
  configNotNumber: (key) => `配置 ${key} 必须指定为数字`,
  configNotInteger: (key) => `配置 ${key} 必须指定为有限整数`,
  configBelowMinimum: (key, min) => `配置 ${key} 必须为 ${min} 以上`,
  configNotBoolean: (key) => `配置 ${key} 必须指定为 boolean`,
  configNotString: (key) => `配置 ${key} 必须指定为字符串`,
  configInvalidMode: (modes) => `配置 mode 必须为 ${modes} 之一`,

  commandUnlockDescription:
    '在因缓存过期而禁止发送的会话中，允许下一次发送(cache-sentinel)',
  commandSentinelDescription:
    '显示 cache-sentinel 状态并切换模式：/sentinel [block|archive|both|off|default]',
}

/** 表示言語ごとの文言カタログ。 */
export const MESSAGES: Record<Locale, Messages> = {
  en,
  ja,
  'zh-CN': zhCN,
}
