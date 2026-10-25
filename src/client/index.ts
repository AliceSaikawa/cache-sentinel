/**
 * cache-sentinel — 公式 Web UI のクライアント半分(spec-ui.md §E3)。
 * 入力欄の上(`conversation.input.dock`)に、キャッシュ切れで入力禁止のときの警告と `/unlock` ボタンを出す。
 * 判定は banner.ts の純粋関数に任せ、ここでは取得と描画だけを行う。React はシェルが提供する。
 */
import { createElement as h, useCallback, useEffect, useState } from 'react'
import { resolveLocale, type Locale } from '../i18n.ts'
import { bannerFor, unlockLabel, type Banner as BannerView, type StatusLike } from './banner.ts'
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

/**
 * バナーの見た目(docs/spike.md「入力欄の上のバナーの見た目」)。
 * - 幅は、すぐ下の入力カードと同じ式にして左右の端をそろえる。
 * - 色・角丸・ボタンは DSH のデザイントークン(`--dsw-*`)を使い、ダークテーマに追従させる。
 *   変数が無くなっても読めるよう、明色テーマの値を既定値に置く。
 * - 狭い幅では、文面を詰めずにボタンだけ次の行へ送る(`flex-wrap` と文面の `flex-basis`)。
 * `:hover` と `:focus-visible` を書くため、インラインスタイルではなくクラスにして、バナーの中の `<style>` で描く。
 */
const CSS = `
.cache-sentinel-banner {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px));
  max-width: var(--dsh-composer-card-max-width, 952px);
  min-height: 36px;
  margin: 0 auto;
  padding: 4px 4px 4px 12px;
  border: 0.5px solid;
  border-radius: var(--dsw-radius-md, 12px);
  color: var(--dsw-alias-label-primary, #0f1115);
  font-size: 13px;
  line-height: 20px;
}
.cache-sentinel-banner[data-tone='warning'] {
  background: var(--dsw-alias-state-warn-tertiary, #fef5e7);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 40%, transparent);
}
.cache-sentinel-banner[data-tone='info'] {
  background: var(--dsw-alias-state-business-tertiary, #e4edfd);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 30%, transparent);
}
.cache-sentinel-icon {
  flex: none;
  display: inline-flex;
  /* 文面が複数行でも 1 行目(上の余白 4px + 行の高さ 20px)の中央に置く */
  align-self: flex-start;
  margin-top: 6px;
}
[data-tone='warning'] > .cache-sentinel-icon {
  color: var(--dsw-alias-state-warn-primary, #f59e0b);
}
[data-tone='info'] > .cache-sentinel-icon {
  color: var(--dsw-alias-state-business-primary, #4176e6);
}
.cache-sentinel-text {
  flex: 1 1 160px;
  min-width: 0;
  padding: 4px 8px 4px 0;
}
.cache-sentinel-failure {
  display: block;
  margin-top: 2px;
  color: var(--dsw-alias-state-error-primary, #ec1313);
  font-size: 12px;
  line-height: 18px;
}
.cache-sentinel-button {
  flex: none;
  box-sizing: border-box;
  height: 28px;
  margin-left: auto;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3, #0000001f);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-button-floating-fill, #fff);
  color: var(--dsw-alias-label-primary, #0f1115);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
}
.cache-sentinel-button:hover:not(:disabled) {
  background: var(--dsw-alias-button-floating-hover, #f1f3f5);
}
.cache-sentinel-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4176e6));
  outline-offset: 1px;
}
.cache-sentinel-button:disabled {
  opacity: 0.5;
  cursor: default;
}
`

/** 16px の線画アイコン。警告は三角に「!」、許可中は開いた錠。 */
const ICON_PATHS = {
  warning: ['M12 3.5 2.5 20h19z', 'M12 10v4.5', 'M12 17.25v.01'],
  info: ['M7 11V7.5a5 5 0 0 1 9.6-1.9', 'M5 11h14v10H5z'],
} as const satisfies Record<BannerView['tone'], readonly string[]>

function Icon({ tone }: { tone: BannerView['tone'] }) {
  return h(
    'span',
    { className: 'cache-sentinel-icon', 'aria-hidden': true },
    h(
      'svg',
      {
        width: 16,
        height: 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      ...ICON_PATHS[tone].map((d) => h('path', { d })),
    ),
  )
}

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
    { role: 'status', 'data-testid': 'cache-sentinel-banner', 'data-tone': banner.tone, className: 'cache-sentinel-banner' },
    h('style', null, CSS),
    h(Icon, { tone: banner.tone }),
    h(
      'span',
      { className: 'cache-sentinel-text' },
      banner.text,
      warning && failure !== undefined
        ? h('span', { role: 'alert', 'data-testid': 'cache-sentinel-unlock-error', className: 'cache-sentinel-failure' }, failure)
        : null,
    ),
    warning
      ? h(
          'button',
          { type: 'button', className: 'cache-sentinel-button', disabled: busy, onClick: () => void onUnlock() },
          unlockLabel(locale),
        )
      : null,
  )
}
