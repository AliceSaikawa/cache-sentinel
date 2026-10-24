/**
 * cache-sentinel — 公式 Web UI のクライアント半分(spec-ui.md §E3)。
 * 入力欄の上(`conversation.input.dock`)に、キャッシュ切れで入力禁止のときの警告と `/unlock` ボタンを出す。
 * 判定は banner.ts の純粋関数に任せ、ここでは取得と描画だけを行う。React はシェルが提供する。
 */
import { createElement as h, useCallback, useEffect, useState } from 'react'
import { resolveLocale, type Locale } from '../i18n.ts'
import { bannerFor, unlockLabel, type StatusLike } from './banner.ts'
import { fetchStatus } from './fetch-status.ts'
import { runUnlock } from './run-unlock.ts'

export const name = 'cache-sentinel-client'
/** `remote.commands` は `remote` とは別のサービスキーなので、両方を宣言する(docs/spike.md、#26)。 */
export const inject = ['slots', 'remote', 'remote.commands']

/** 取得の間隔(spec-ui.md §E2)。 */
export const POLL_MS = 30_000

interface SlotsService {
  inject(name: string, register: () => () => void): void
  register(
    options: { name: string; id: string; order: number; inject: (sessionId: string) => BannerProps },
    component: (props: BannerProps) => unknown,
  ): () => void
}

interface RemoteService {
  commands: { execute(sessionId: string, line: string, attachments: readonly unknown[]): Promise<unknown> }
}

interface BannerProps {
  sessionId: string
  locale: Locale
  unlock: () => Promise<unknown>
}

/**
 * ブラウザの言語候補から表示言語を決める (spec-ui.md §F)。
 * `navigator.languages`(優先順)を使い、無ければ `navigator.language`。
 */
function browserLocale(): Locale {
  return resolveLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language])
}

export function apply(ctx: unknown): void {
  const { slots, remote } = ctx as { slots: SlotsService; remote: RemoteService }
  const locale = browserLocale()
  slots.inject('conversation.input.dock', () =>
    slots.register(
      {
        name: 'conversation.input.dock',
        id: 'cache-sentinel',
        order: 5,
        inject: (sessionId) => ({
          sessionId,
          locale,
          unlock: () => remote.commands.execute(sessionId, '/unlock', []),
        }),
      },
      Banner,
    ),
  )
}

const styles = {
  box: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '0 0 8px',
    padding: '8px 12px',
    borderRadius: 12,
    fontSize: 13,
    lineHeight: '20px',
    color: 'var(--dsw-alias-label-primary, inherit)',
  },
  warning: { background: 'rgba(245, 158, 11, 0.14)', border: '1px solid rgba(245, 158, 11, 0.45)' },
  info: { background: 'rgba(59, 130, 246, 0.10)', border: '1px solid rgba(59, 130, 246, 0.35)' },
  text: { flex: 1 },
  failure: { display: 'block', marginTop: 4, fontWeight: 600 },
  button: {
    flex: 'none',
    padding: '4px 10px',
    borderRadius: 8,
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
  },
} as const

function Banner({ sessionId, locale, unlock }: BannerProps) {
  const [status, setStatus] = useState<StatusLike | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    setStatus(await fetchStatus(sessionId, document.baseURI))
  }, [sessionId])

  useEffect(() => {
    setStatus(undefined)
    setFailure(undefined)
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const banner = bannerFor(status, Date.now(), locale)
  const warning = banner?.tone === 'warning'
  // 失敗の文面は警告に付けて出す。警告が消えたら(許可中になった等)捨てる。
  useEffect(() => {
    if (!warning) setFailure(undefined)
  }, [warning])
  if (banner === undefined) return null

  const onUnlock = async () => {
    setBusy(true)
    setFailure(undefined)
    const result = await runUnlock(unlock, locale)
    if (result !== undefined) console.warn(`[cache-sentinel] バナーからの /unlock に失敗しました: ${result}`)
    setFailure(result)
    setBusy(false)
    await load()
  }

  return h(
    'div',
    { role: 'status', 'data-testid': 'cache-sentinel-banner', style: { ...styles.box, ...styles[banner.tone] } },
    h(
      'span',
      { style: styles.text },
      banner.text,
      warning && failure !== undefined
        ? h('span', { role: 'alert', 'data-testid': 'cache-sentinel-unlock-error', style: styles.failure }, failure)
        : null,
    ),
    warning
      ? h('button', { type: 'button', style: styles.button, disabled: busy, onClick: () => void onUnlock() }, unlockLabel(locale))
      : null,
  )
}
