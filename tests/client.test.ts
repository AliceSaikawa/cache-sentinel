/**
 * 公式 Web UI のクライアント半分(lib/client.js)を、DSH のモジュールローダーと同じ形で読み込んで確かめる。
 * React はシェルが提供するので、描画しない範囲(apply とスロットの登録)だけを見る。
 *
 * ctx は cordis と同じく、inject に宣言していないサービスに触ると例外を投げる
 * (`cannot get property "<name>" without inject`、docs/spike.md「クライアント側 `remote.commands` の inject」)。
 * `remote.commands` は `remote` とは別のサービスキーとして扱う(#26)。
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

function loadClient(): ClientModule {
  let loaded: ClientModule | undefined
  const window = {
    __ModuleLoader__: {
      load({ factory }: { id: string; factory: (require: (id: string) => unknown) => ClientModule }) {
        loaded = factory((id) => {
          if (id === 'react') return {}
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
function contextFor(inject: readonly string[], services: Record<string, object>): unknown {
  const guard = (name: string) => {
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
