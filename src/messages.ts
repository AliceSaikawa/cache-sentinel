/**
 * 表示文言のカタログ (spec-ui v0.5 §F)。DSH には依存しない純粋な値だけを置く。
 *
 * 3 言語 `en` / `ja` / `zh-CN` で同じキーと引数を持つことを型で保証する
 * (`Record<Locale, Messages>` にオブジェクトリテラルで代入する)。
 * 日本語は v0.5 までの文言と 1 文字も変えていない。
 */

import type { Config } from './config.ts'
import type { Locale } from './i18n.ts'
import type { Mode } from './modes.ts'

/** 設定ページで編集できるキー(stateFile 以外。src/config.ts の CONFIG_KEYS の live)。 */
export type SettingsKey = Exclude<keyof Config, 'stateFile'>

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
  /** ボタンで `/unlock` を実行できなかったとき。`detail` は失敗の内容(エラーコードなど、翻訳しない)。 */
  readonly bannerUnlockFailed: (detail: string) => string
  /** ボタンで実行した `/unlock` が Host に見つからなかったとき。 */
  readonly bannerUnlockNotFound: string

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
  /** `/sentinel` の引数のヒント(入力欄のプレースホルダ)。引数は任意。 */
  readonly commandSentinelInputHint: string

  // --- 設定ページ (src/client/settings-page.ts、#10) ---
  /** 各キーの見出し。 */
  readonly settingsLabels: Readonly<Record<SettingsKey, string>>
  /** 各キーの説明(見出しの下)。 */
  readonly settingsHints: Readonly<Record<SettingsKey, string>>
  /** モードの選択肢の表示名。 */
  readonly settingsModeOptions: Readonly<Record<Mode, string>>
  /** 整数の入力が不正なとき。 */
  readonly settingsInvalidInteger: (min: number) => string
  /** 既定から変えている印。 */
  readonly settingsOverridden: string
  /** 既定に戻すボタン。 */
  readonly settingsReset: string
  /** 設定が読み取り専用のとき。 */
  readonly settingsReadOnly: string
  /** Host 側が動いていなくて設定できないとき。 */
  readonly settingsUnavailable: string
  /** 保存ボタン。 */
  readonly settingsSave: string
  /** 保存中のボタン。 */
  readonly settingsSaving: string
  /** 保存が受け付けられなかったとき。 */
  readonly settingsSaveFailed: string
  /** stateFile はここでは変えられない旨。 */
  readonly settingsStateFileNote: string
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
  bannerUnlockFailed: (detail) => `Could not run /unlock (${detail}). Send /unlock from the input box instead.`,
  bannerUnlockNotFound: '/unlock was not found. The cache-sentinel host plugin may not be running.',

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
  commandSentinelInputHint: '[block|archive|both|off|default]',
  settingsLabels: {
    mode: 'Mode',
    idleMinutes: 'Minutes until sends are blocked',
    archiveAfterMinutes: 'Minutes until archiving (both mode)',
    unlockTtlMinutes: 'Minutes /unlock stays valid',
    checkIntervalSeconds: 'Archive check interval (seconds)',
    skipPinned: 'Do not archive pinned sessions',
    archiveExisting: 'Also archive sessions that were already idle',
    maxPerCycle: 'Sessions archived per check (max)',
    dryRun: 'Dry run (log only)',
  },
  settingsHints: {
    mode: 'block: block sends; archive: archive sessions; both: block, then archive later; off: do nothing. A mode chosen with /sentinel takes precedence (/sentinel default returns to this one).',
    idleMinutes: 'Minutes since the last response. Also the archive threshold in archive mode. Integer, 1 or more.',
    archiveAfterMinutes: 'Archive threshold in both mode. Integer, 1 or more.',
    unlockTtlMinutes: 'How long an /unlock allowance lasts. Integer, 1 or more.',
    checkIntervalSeconds: 'How often to look for sessions to archive. Integer, 10 or more.',
    skipPinned: 'Pinned sessions are never archived.',
    archiveExisting: 'Include sessions that stopped before archiving was first enabled.',
    maxPerCycle: 'Upper limit per check. Integer, 1 or more.',
    dryRun: 'Neither block nor archive; only write what would happen to the log.',
  },
  settingsModeOptions: { block: 'block', archive: 'archive', both: 'both', off: 'off' },
  settingsInvalidInteger: (min) => `Enter an integer of ${min} or more, or leave blank to use the default.`,
  settingsOverridden: 'Changed',
  settingsReset: 'Reset to default',
  settingsReadOnly: 'This deployment stores settings read-only.',
  settingsUnavailable: 'cache-sentinel is not running, so it cannot be configured right now.',
  settingsSave: 'Save',
  settingsSaving: 'Saving…',
  settingsSaveFailed: 'These values were not accepted; they are kept here for you to correct.',
  settingsStateFileNote: 'The state file location (stateFile) is set in the profile patch, not here.',
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
  bannerUnlockFailed: (detail) => `/unlock を実行できませんでした(${detail})。入力欄から /unlock を送ってください。`,
  bannerUnlockNotFound: '/unlock が見つかりません。cache-sentinel の Host 側が動いていない可能性があります。',

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
  commandSentinelInputHint: '[block|archive|both|off|default]',
  settingsLabels: {
    mode: 'モード',
    idleMinutes: '入力禁止までの分数',
    archiveAfterMinutes: 'アーカイブまでの分数(both モード)',
    unlockTtlMinutes: '/unlock の有効時間(分)',
    checkIntervalSeconds: 'アーカイブの確認間隔(秒)',
    skipPinned: 'ピン留めしたセッションはアーカイブしない',
    archiveExisting: '前から止まっていたセッションもアーカイブする',
    maxPerCycle: '1 回にアーカイブする上限',
    dryRun: 'ログだけ出す(dryRun)',
  },
  settingsHints: {
    mode: 'block: 送信を止める / archive: アーカイブする / both: 送信を止め、さらに後でアーカイブ / off: 何もしない。/sentinel で選んだモードがあればそちらが優先されます(/sentinel default でここの値に戻ります)。',
    idleMinutes: '最終応答からの分数。archive モードではアーカイブのしきい値にもなります。1 以上の整数。',
    archiveAfterMinutes: 'both モードのアーカイブのしきい値。1 以上の整数。',
    unlockTtlMinutes: '/unlock で許可した送信の有効時間。1 以上の整数。',
    checkIntervalSeconds: 'アーカイブするセッションを探す間隔。10 以上の整数。',
    skipPinned: 'ピン留めしたセッションはアーカイブしません。',
    archiveExisting: 'アーカイブを初めて有効にする前に止まっていたセッションも対象にします。',
    maxPerCycle: '1 回の確認でアーカイブする件数の上限。1 以上の整数。',
    dryRun: '送信を止めず、アーカイブもせず、そうする予定だったことをログに出すだけにします。',
  },
  settingsModeOptions: { block: 'block', archive: 'archive', both: 'both', off: 'off' },
  settingsInvalidInteger: (min) => `${min} 以上の整数を入力してください。空欄にすると既定値に戻ります。`,
  settingsOverridden: '変更あり',
  settingsReset: '既定値に戻す',
  settingsReadOnly: 'この環境では設定は読み取り専用です。',
  settingsUnavailable: 'cache-sentinel が動いていないため、いまは設定できません。',
  settingsSave: '保存',
  settingsSaving: '保存中…',
  settingsSaveFailed: 'この値は受け付けられませんでした。直せるよう入力はそのまま残しています。',
  settingsStateFileNote: '状態ファイルの場所(stateFile)は、ここではなくプロファイルの patch で設定します。',
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
  bannerUnlockFailed: (detail) => `无法执行 /unlock(${detail})。请在输入框中发送 /unlock。`,
  bannerUnlockNotFound: '找不到 /unlock。cache-sentinel 的 Host 端可能未在运行。',

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
  commandSentinelInputHint: '[block|archive|both|off|default]',
  settingsLabels: {
    mode: '模式',
    idleMinutes: '禁止发送前的分钟数',
    archiveAfterMinutes: '归档前的分钟数(both 模式)',
    unlockTtlMinutes: '/unlock 的有效分钟数',
    checkIntervalSeconds: '归档检查间隔(秒)',
    skipPinned: '不归档已置顶的会话',
    archiveExisting: '也归档此前已停止的会话',
    maxPerCycle: '每次检查最多归档的会话数',
    dryRun: '仅记录日志(dryRun)',
  },
  settingsHints: {
    mode: 'block：禁止发送；archive：归档会话；both：禁止发送，之后再归档；off：不执行任何操作。若用 /sentinel 选择了模式，则以其为准(/sentinel default 可恢复为此处的值)。',
    idleMinutes: '距上次响应的分钟数。在 archive 模式下也是归档阈值。不小于 1 的整数。',
    archiveAfterMinutes: 'both 模式的归档阈值。不小于 1 的整数。',
    unlockTtlMinutes: '/unlock 许可的有效时间。不小于 1 的整数。',
    checkIntervalSeconds: '查找待归档会话的间隔。不小于 10 的整数。',
    skipPinned: '已置顶的会话不会被归档。',
    archiveExisting: '包括首次启用归档之前就已停止的会话。',
    maxPerCycle: '每次检查归档的数量上限。不小于 1 的整数。',
    dryRun: '既不禁止发送也不归档，只把将要执行的操作写入日志。',
  },
  settingsModeOptions: { block: 'block', archive: 'archive', both: 'both', off: 'off' },
  settingsInvalidInteger: (min) => `请输入不小于 ${min} 的整数；留空则使用默认值。`,
  settingsOverridden: '已修改',
  settingsReset: '恢复默认',
  settingsReadOnly: '本部署的设置为只读。',
  settingsUnavailable: 'cache-sentinel 未运行，暂时无法设置。',
  settingsSave: '保存',
  settingsSaving: '保存中…',
  settingsSaveFailed: '这些值未被接受，已保留供你修改。',
  settingsStateFileNote: '状态文件的位置(stateFile)在配置文件的 patch 中设置，不在此处。',
}

/** 表示言語ごとの文言カタログ。 */
export const MESSAGES: Record<Locale, Messages> = {
  en,
  ja,
  'zh-CN': zhCN,
}
