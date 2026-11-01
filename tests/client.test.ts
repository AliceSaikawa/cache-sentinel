/**
 * 公式 Web UI のクライアント半分(lib/client.js)を、DSH のモジュールローダーと同じ形で読み込んで確かめる。
 * React はシェルが提供するので、描画しない範囲(apply とスロットの登録)だけを見る。
 *
 * ctx は cordis と同じく、inject に宣言していないサービスに触ると例外を投げる
 * (`cannot get property "<name>" without inject`、docs/spike.md「クライアント側 `remote.commands` の inject」)。
 * `remote.commands` は `remote` とは別のサービスキーとして扱う(#26)。
 * `inject`(任意のサービスを待つ子プラグインを作る)と `effect` はサービスではなく ctx のメソッドなので、宣言なしで使える。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface ClientModule {
  name: string
  inject: string[]
  apply(ctx: unknown): void
}

interface SlotOptions {
  name: string
  id: string
  order: number
  inject: (sessionId: string) => { sessionId: string; locale: string; unlock: () => Promise<unknown> }
}

/** 設定ページ (#10) が使う `@deepseek-ai/dsh-client-ui-primitives` の偽物。部品は描画しないので名前だけ。 */
class FakeSettingsFormModel {
  readonly specs: { field: string; parse(text: string): unknown }[]
  disposed = false
  constructor(_scope: unknown, specs: { field: string; parse(text: string): unknown }[]) {
    this.specs = specs
  }
  bind(project: () => unknown) {
    return { getSnapshot: project, subscribe: () => () => {} }
  }
  shell() {
    return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
  }
  field() {
    return { text: '', overridden: false, invalid: false }
  }
  actions() {
    return { edit() {}, resetField() {}, save() {}, discard() {} }
  }
  dispose() {
    this.disposed = true
  }
}
const fakePrimitives = {
  SettingsFormModel: FakeSettingsFormModel,
  SettingsForm: () => null,
  SettingsValueField: () => null,
  Switch: () => null,
  SegmentedControl: () => null,
  Tag: () => null,
}

function loadClient(): ClientModule {
  let loaded: ClientModule | undefined
  const window = {
    __ModuleLoader__: {
      load({ factory }: { id: string; factory: (require: (id: string) => unknown) => ClientModule }) {
        loaded = factory((id) => {
          if (id === 'react') return {}
          if (id === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives
          throw new Error(`unexpected require: ${id}`)
        })
      },
    },
  }
  runInNewContext(readFileSync(resolve(root, 'lib/client.js'), 'utf8'), {
    window,
    navigator: { languages: ['ja-JP'], language: 'ja-JP' },
  })
  assert.ok(loaded, 'lib/client.js did not call __ModuleLoader__.load')
  return loaded
}

/** vm の中で作った配列はプロトタイプが別なので、比べる前にこちらの値に写す。 */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

/** cordis の ctx と同じく、宣言していないサービスへのアクセスで例外を投げる ctx。 */
function contextFor(
  inject: readonly string[],
  services: Record<string, object>,
  methods: { inject?: unknown; effect?: unknown } = { inject: () => {}, effect: () => {} },
): unknown {
  const guard = (name: string) => {
    if (name === 'inject' || name === 'effect') return methods[name]
    if (!inject.includes(name)) throw new Error(`cannot get property "${name}" without inject`)
    return services[name]
  }
  const remote = new Proxy(services['remote'] ?? {}, {
    get: (target, prop) => (prop === 'commands' ? guard('remote.commands') : Reflect.get(target, prop)),
  })
  return new Proxy(
    {},
    { get: (_target, prop) => (prop === 'remote' ? (guard('remote'), remote) : guard(String(prop))) },
  )
}

test('client: inject に remote.commands を宣言している', () => {
  assert.deepEqual(plain(loadClient().inject), ['slots', 'remote', 'remote.commands'])
})

test('client: バナーの unlock がこのセッションに /unlock を実行し、戻り値を返す', async () => {
  const client = loadClient()
  const registered: SlotOptions[] = []
  const calls: unknown[][] = []
  const slots = {
    inject(_name: string, register: () => () => void) {
      register()
    },
    register(options: SlotOptions) {
      registered.push(options)
      return () => {}
    },
  }
  const commands = {
    async execute(...args: unknown[]) {
      calls.push(args)
      return { ok: true, value: { result: { kind: 'success' } } }
    },
  }
  client.apply(contextFor(client.inject, { slots, remote: {}, 'remote.commands': commands }))

  assert.deepEqual(
    registered.map(({ name, id, order }) => ({ name, id, order })),
    [{ name: 'conversation.input.dock', id: 'cache-sentinel', order: 5 }],
  )
  const props = registered[0]!.inject('ses-1')
  assert.equal(props.sessionId, 'ses-1')
  assert.equal(props.locale, 'ja')
  assert.deepEqual(await props.unlock(), { ok: true, value: { result: { kind: 'success' } } })
  assert.deepEqual(plain(calls), [['ses-1', '/unlock', []]])
})

// ---- 設定ページ (#10) ----

interface PageRegistration {
  name: string
  key: string
  inject: () => { hooks: { settingsPage: { getSnapshot(): Record<string, unknown> } }; locale: string }
}

test('#10: configForms がある環境では、プラグイン画面の cache-sentinel のページに設定フォームを出す', () => {
  const client = loadClient()
  const registered: (SlotOptions | PageRegistration)[] = []
  const injectedSlots: string[] = []
  const slots = {
    inject(name: string, register: () => () => void) {
      injectedSlots.push(name)
      return register()
    },
    register(options: SlotOptions | PageRegistration) {
      registered.push(options)
      return () => {}
    },
  }
  const effects: (() => unknown)[] = []
  const childInjects: string[][] = []
  const served: string[][] = []
  const forms: string[] = []
  const configForms = {
    get(entryId: string) {
      forms.push(entryId)
      return { getSnapshot() {}, subscribe: () => () => {}, mutate: async () => true }
    },
    whileServed(namespaces: string[], register: () => () => void) {
      served.push([...namespaces])
      return register()
    },
  }
  const child = {
    configForms,
    effect: (execute: () => unknown) => {
      effects.push(execute)
      execute()
    },
  }
  client.apply(
    contextFor(
      client.inject,
      { slots, remote: {}, 'remote.commands': {} },
      {
        inject: (deps: string[], callback: (ctx: unknown) => void) => {
          childInjects.push([...deps])
          callback(child)
        },
        effect: () => {},
      },
    ),
  )

  // 必須の inject は増やさない(configForms が無くてもバナーは動く)。
  assert.deepEqual(plain(client.inject), ['slots', 'remote', 'remote.commands'])
  assert.deepEqual(plain(childInjects), [['configForms']])
  assert.deepEqual(plain(forms), ['cache-sentinel'])
  assert.deepEqual(plain(served), [['cache-sentinel']])
  assert.deepEqual(plain(injectedSlots), ['conversation.input.dock', 'plugins.bundle.config'])
  const page = registered.find((entry): entry is PageRegistration => entry.name === 'plugins.bundle.config')
  assert.ok(page)
  assert.equal(page.key, 'cache-sentinel')
  const face = page.inject()
  assert.equal(face.locale, 'ja')
  const snapshot = face.hooks.settingsPage.getSnapshot()
  assert.deepEqual(
    Object.keys(snapshot).filter((key) => !['available', 'writable', 'dirty', 'invalid', 'saving', 'failed'].includes(key)),
    ['mode', 'idleMinutes', 'archiveAfterMinutes', 'unlockTtlMinutes', 'checkIntervalSeconds', 'skipPinned', 'archiveExisting', 'maxPerCycle', 'dryRun'],
  )
})
