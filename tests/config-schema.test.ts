/**
 * #10: 設定画面用の Config スキーマ (src/config-schema.ts)、設定キーの表 (src/config.ts の CONFIG_KEYS)、
 * 設定画面で保存したときの反映 (src/index.ts の createRuntime.reconfigure と apply の loader/volatile-update) のテスト。
 *
 * 本物の `@deepseek-ai/schemastery` は DSH が実行時に提供するもので、このリポジトリの依存には無い。
 * 本物で確かめるテストは、環境変数 `CACHE_SENTINEL_SCHEMASTERY` にそのパッケージのディレクトリを渡したときだけ動く
 * (例: `<DSH のインストール先>/node_modules/@deepseek-ai/schemastery`)。渡さなければ skip する。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CONFIG_KEYS, DEFAULTS, parseConfig, plainConfig, type Config } from '../src/config.ts'
import { buildConfigSchema, ConfigSchema, loadSchemaFactory, type SchemaFactory, type SchemaNode } from '../src/config-schema.ts'
import type { PreStepDecision, PreStepPayload } from '../src/block.ts'
import type { CycleDeps } from '../src/cycle.ts'
import { apply, createRuntime, STATUS_PATH, type HostContext } from '../src/index.ts'
import type { Logger } from '../src/log.ts'
import { MODES } from '../src/modes.ts'
import type { StatusPayload } from '../src/status.ts'

const MINUTE = 60_000
const NOW = 1_700_000_000_000

/** 整数キーとその下限 (spec §6)。 */
const INTEGER_KEYS: ReadonlyArray<readonly [string, number]> = [
  ['idleMinutes', 1],
  ['archiveAfterMinutes', 1],
  ['unlockTtlMinutes', 1],
  ['checkIntervalSeconds', 10],
  ['maxPerCycle', 1],
]
const BOOLEAN_KEYS = ['skipPinned', 'archiveExisting', 'dryRun'] as const

// ---- 設定キーの表 ----

test('#10: CONFIG_KEYS は spec §6 のキー・型・下限と一致し、DEFAULTS と同じキーを持つ', () => {
  assert.deepEqual(
    CONFIG_KEYS.map((spec) => spec.key),
    ['mode', 'idleMinutes', 'archiveAfterMinutes', 'unlockTtlMinutes', 'checkIntervalSeconds', 'skipPinned', 'archiveExisting', 'maxPerCycle', 'dryRun', 'stateFile'],
  )
  for (const [key, min] of INTEGER_KEYS) {
    const spec = CONFIG_KEYS.find((candidate) => candidate.key === key)
    assert.ok(spec?.kind === 'integer', `${key} は integer`)
    assert.equal(spec.min, min, `${key} の下限`)
  }
  for (const key of BOOLEAN_KEYS) {
    assert.equal(CONFIG_KEYS.find((spec) => spec.key === key)?.kind, 'boolean', key)
  }
  assert.deepEqual(
    CONFIG_KEYS.filter((spec) => spec.key !== 'stateFile').map((spec) => spec.key).sort(),
    Object.keys(DEFAULTS).sort(),
  )
})

test('#10: stateFile 以外は設定画面から変えられる(live)', () => {
  assert.deepEqual(
    CONFIG_KEYS.filter((spec) => !spec.live).map((spec) => spec.key),
    ['stateFile'],
  )
})

// ---- plainConfig ----

/** cosmokit の Volatile と同じ形の参照(get で今の値を返す)。 */
function ref<T>(value: T): { get(): T; set(next: T): void } {
  let current = value
  return {
    get: () => current,
    set: (next) => {
      current = next
    },
  }
}

test('#10: plainConfig は volatile の参照を値に戻し、それ以外はそのまま返す', () => {
  assert.deepEqual(plainConfig({ mode: ref('both'), idleMinutes: ref(5), stateFile: '/x' }), {
    mode: 'both',
    idleMinutes: 5,
    stateFile: '/x',
  })
  for (const raw of [undefined, null, 1, 'x', [1]]) {
    assert.deepEqual(plainConfig(raw), raw)
  }
  // 値に戻した後は parseConfig がこれまでどおり検証する。
  assert.throws(() => parseConfig(plainConfig({ idleMinutes: ref(0) }), 'ja'), /idleMinutes/)
  assert.throws(() => parseConfig(plainConfig({ typo: ref(1) }), 'ja'), /typo/)
})

// ---- スキーマの組み立て(偽の schemastery で記録する) ----

interface Recorded {
  type: string
  args: unknown[]
  calls: [string, unknown][]
  dict?: Record<string, Recorded>
  list?: Recorded[]
}

/** 呼ばれたメソッドを記録するだけの schemastery の偽物。 */
function recordingFactory(): SchemaFactory {
  const node = (type: string, args: unknown[], extra: Partial<Recorded> = {}): SchemaNode & Recorded => {
    const self: Recorded = { type, args, calls: [], ...extra }
    const chain = (name: string) => (value?: unknown) => {
      self.calls.push([name, value])
      return api
    }
    const api = Object.assign(self, {
      default: chain('default'),
      description: chain('description'),
      min: chain('min'),
      step: chain('step'),
      volatile: chain('volatile'),
    }) as SchemaNode & Recorded
    return api
  }
  return {
    object: (dict) => node('object', [], { dict: dict as unknown as Record<string, Recorded> }),
    union: (list) => node('union', [], { list: list as unknown as Recorded[] }),
    const: (value) => node('const', [value]),
    number: () => node('number', []),
    boolean: () => node('boolean', []),
    string: () => node('string', []),
  }
}

test('#10: buildConfigSchema は CONFIG_KEYS と DEFAULTS から型・下限・既定値・volatile を組む', () => {
  const schema = buildConfigSchema(recordingFactory()) as unknown as Recorded
  assert.equal(schema.type, 'object')
  const dict = schema.dict ?? {}
  assert.deepEqual(Object.keys(dict), CONFIG_KEYS.map((spec) => spec.key))

  const callsOf = (key: string) => Object.fromEntries(dict[key]?.calls ?? [])
  const mode = dict.mode
  assert.equal(mode?.type, 'union')
  assert.deepEqual(mode?.list?.map((item) => item.args[0]), [...MODES])
  for (const [key, min] of INTEGER_KEYS) {
    assert.equal(dict[key]?.type, 'number', key)
    assert.equal(callsOf(key).step, 1, `${key} は整数`)
    assert.equal(callsOf(key).min, min, `${key} の下限`)
  }
  for (const key of BOOLEAN_KEYS) assert.equal(dict[key]?.type, 'boolean', key)
  assert.equal(dict.stateFile?.type, 'string')

  for (const spec of CONFIG_KEYS) {
    const calls = callsOf(spec.key)
    assert.equal(typeof calls.description, 'string', `${spec.key} の説明`)
    assert.equal('volatile' in calls, spec.live, `${spec.key} の volatile`)
    if (spec.key === 'stateFile') assert.equal('default' in calls, false)
    else assert.deepEqual(calls.default, DEFAULTS[spec.key], `${spec.key} の既定値`)
  }
})

test('#10: schemastery が無い環境では Config は undefined', async () => {
  // このリポジトリの依存には schemastery が無い(DSH が実行時に提供する)。
  assert.equal(await loadSchemaFactory(), undefined)
  assert.equal(ConfigSchema, undefined)
})

// ---- 本物の schemastery での検証(環境変数があるときだけ) ----

const realDir = process.env.CACHE_SENTINEL_SCHEMASTERY
const real: SchemaFactory | undefined = (() => {
  if (realDir === undefined || realDir === '') return undefined
  const require = createRequire(join(realDir, 'package.json'))
  return require(realDir) as SchemaFactory
})()
const realSkip = real === undefined ? 'CACHE_SENTINEL_SCHEMASTERY が無い(本物の schemastery は DSH が提供する)' : false

interface RealSchema {
  (value: unknown): unknown
  dict: Record<string, { meta: { volatile?: boolean } }>
  '~standard': { validate(value: unknown): { value?: unknown; issues?: readonly { message: string; path?: readonly unknown[] }[] } }
}

function realSchema(): RealSchema {
  assert.ok(real)
  return buildConfigSchema(real) as unknown as RealSchema
}

/** 設定画面とホストの保存処理が通す検証(cordis の resolveConfig と同じ `~standard.validate`)。 */
function validate(value: unknown) {
  return realSchema()['~standard'].validate(value)
}

test('#10 (本物): 空の設定は DEFAULTS になり、live のキーは get() で読む参照になる', { skip: realSkip }, () => {
  const result = validate({})
  assert.equal(result.issues, undefined)
  const value = result.value as Record<string, unknown>
  for (const spec of CONFIG_KEYS) {
    if (!spec.live) continue
    const item = value[spec.key] as { get?: () => unknown }
    assert.equal(typeof item?.get, 'function', `${spec.key} は参照`)
  }
  assert.deepEqual(parseConfig(plainConfig(value), 'en'), { ...DEFAULTS })
})

test('#10 (本物): 設定画面が編集対象にするのは stateFile 以外の全キー(volatile)', { skip: realSkip }, () => {
  const dict = realSchema().dict
  for (const spec of CONFIG_KEYS) {
    assert.equal(dict[spec.key]?.meta.volatile === true, spec.live, spec.key)
  }
})

test('#10 (本物): 不正な値を拒否する(下限未満・非整数・型不正・mode)', { skip: realSkip }, () => {
  for (const [key, min] of INTEGER_KEYS) {
    for (const bad of [min - 1, 1.5 + min, '60', true]) {
      const result = validate({ [key]: bad })
      assert.ok(result.issues !== undefined && result.issues.length > 0, `${key}: ${JSON.stringify(bad)} は拒否`)
    }
    assert.equal(validate({ [key]: min }).issues, undefined, `${key}: 下限ちょうどは受け入れる`)
  }
  for (const key of BOOLEAN_KEYS) {
    assert.ok(validate({ [key]: 'true' }).issues, `${key}: 文字列は拒否`)
  }
  assert.ok(validate({ stateFile: 1 }).issues, 'stateFile: 数値は拒否')
  for (const bad of ['none', 'Block', 1]) {
    assert.ok(validate({ mode: bad }).issues, `mode: ${JSON.stringify(bad)} は拒否`)
  }
  for (const mode of MODES) assert.equal(validate({ mode }).issues, undefined, mode)
})

test('#10 (本物): 全キーを指定した設定をそのまま通す', { skip: realSkip }, () => {
  const raw = {
    mode: 'both',
    idleMinutes: 1,
    archiveAfterMinutes: 2880,
    unlockTtlMinutes: 30,
    checkIntervalSeconds: 10,
    skipPinned: false,
    archiveExisting: true,
    maxPerCycle: 5,
    dryRun: true,
    stateFile: '/var/state.json',
  }
  const result = validate(raw)
  assert.equal(result.issues, undefined)
  assert.deepEqual(parseConfig(plainConfig(result.value), 'en'), raw)
})

// ---- 保存したときの反映(createRuntime.reconfigure) ----

function silentLogger(lines: string[] = []): Logger {
  return {
    debug: (msg) => lines.push(`debug:${msg}`),
    info: (msg) => lines.push(`info:${msg}`),
    warn: (msg) => lines.push(`warn:${msg}`),
  }
}

function runtimeWith(config: Config, listCalls: { count: number }) {
  const deps: CycleDeps = {
    now: () => NOW,
    listSessions: async () => {
      listCalls.count += 1
      return []
    },
    archivedIds: () => [],
    archive: async () => {},
    isActiveError: () => false,
    log: silentLogger(),
  }
  return createRuntime(config, { version: 2, unarchivedAt: {} }, deps, silentLogger(), { now: () => NOW, save: async () => {} }, 'ja')
}

test('#10: reconfigure の後は新しい idleMinutes で判定する', async () => {
  const runtime = runtimeWith(parseConfig({ idleMinutes: 60 }, 'ja'), { count: 0 })
  const payload: PreStepPayload = {
    agent: { session: { id: 's1', snapshotEvents: () => [{ type: 'step/end', time: NOW - 30 * MINUTE }] } },
    messages: [{ content: [{ type: 'text', text: '入力' }], source: { kind: 'user' } }],
    turn: 1,
    step: 1,
  }
  const next = async (): Promise<PreStepDecision> => ({ kind: 'enter' })
  assert.equal((await runtime.onPreStep(payload, next)).kind, 'enter')

  runtime.reconfigure(parseConfig({ idleMinutes: 20 }, 'ja'))
  assert.equal(runtime.config().idleMinutes, 20)
  assert.equal((await runtime.onPreStep(payload, next)).kind, 'reject')
})

test('#10: reconfigure で設定のモードを変えると実効モードが変わり、アーカイブが有効になればすぐ回す', async () => {
  const listCalls = { count: 0 }
  const runtime = runtimeWith(parseConfig({ mode: 'block' }, 'ja'), listCalls)
  assert.equal(runtime.mode(), 'block')
  runtime.reconfigure(parseConfig({ mode: 'archive' }, 'ja'))
  assert.equal(runtime.mode(), 'archive')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(listCalls.count, 1)
})

// ---- apply の配線(loader/volatile-update) ----

interface FakeHost {
  ctx: HostContext
  intervals: { delayMs: number; stopped: boolean }[]
  emitVolatileUpdate(): void
  status(): Promise<StatusPayload>
  logs: string[]
}

function fakeHost(): FakeHost {
  const intervals: { delayMs: number; stopped: boolean }[] = []
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const logs: string[] = []
  let route: { fetch: (request: Request) => Promise<Response> } | undefined
  const raw = {
    get: () => undefined,
    on(name: string, listener: (...args: unknown[]) => unknown) {
      listeners.set(name, listener)
      return () => true
    },
    commands: { register: () => () => true },
    interval(_callback: () => void, delayMs: number) {
      const entry = { delayMs, stopped: false }
      intervals.push(entry)
      return () => {
        entry.stopped = true
      }
    },
    logger: silentLogger(logs),
    workspaceRegistry: { archivedSessionIds: [], pinnedSessionIds: [], archiveSession: async () => {} },
    sessionPersistence: { list: async () => [] },
    sessions: { get: () => undefined },
    connection: {
      fetch: {
        register(next: { fetch: (request: Request) => Promise<Response> }) {
          route = next
          return {}
        },
      },
    },
  }
  return {
    ctx: raw as unknown as HostContext,
    intervals,
    logs,
    emitVolatileUpdate: () => {
      const listener = listeners.get('loader/volatile-update')
      assert.ok(listener, 'loader/volatile-update を購読していない')
      listener([['idleMinutes']])
    },
    status: async () => {
      assert.ok(route)
      const response = await route.fetch(new Request(`http://x${STATUS_PATH}?sessionId=s1`))
      return (await response.json()) as StatusPayload
    },
  }
}

test('#10: apply は volatile の参照で渡された設定を読み、保存の通知で新しい値に差し替えて interval を張り直す', async (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-schema-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const host = fakeHost()
  const mode = ref('block')
  const dryRun = ref(false)
  const interval = ref(30)
  const config = { mode, dryRun, checkIntervalSeconds: interval, stateFile: join(dir, 'state.json') }

  await apply(host.ctx, config)
  assert.deepEqual(host.intervals, [{ delayMs: 30_000, stopped: false }])
  assert.equal((await host.status()).mode, 'block')
  assert.equal((await host.status()).dryRun, false)

  // DSH は参照の中身を書き換えてから loader/volatile-update を出す。
  mode.set('off')
  dryRun.set(true)
  interval.set(120)
  host.emitVolatileUpdate()

  const status = await host.status()
  assert.equal(status.mode, 'off')
  assert.equal(status.dryRun, true)
  assert.deepEqual(host.intervals, [
    { delayMs: 30_000, stopped: true },
    { delayMs: 120_000, stopped: false },
  ])
  assert.ok(host.logs.some((line) => line.startsWith('info:設定を反映しました')))
})

test('#10: 間隔が変わらなければ interval は張り直さない', async (t) => {
  t.mock.method(console, 'log', () => {})
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-schema-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const host = fakeHost()
  const idle = ref(60)
  await apply(host.ctx, { idleMinutes: idle, stateFile: join(dir, 'state.json') })
  idle.set(5)
  host.emitVolatileUpdate()
  assert.deepEqual(host.intervals, [{ delayMs: 60_000, stopped: false }])
})

test('#10: 反映できない値(スキーマで弾けない未知のキーなど)は warn を出して前の設定のまま動く', async (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})
  const dir = await mkdtemp(join(tmpdir(), 'cache-sentinel-schema-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const host = fakeHost()
  const mode = ref<unknown>('block')
  await apply(host.ctx, { mode, stateFile: join(dir, 'state.json') })
  mode.set('none')
  host.emitVolatileUpdate()
  assert.equal((await host.status()).mode, 'block')
  assert.ok(host.logs.some((line) => line.startsWith('warn:新しい設定を反映できませんでした')))
  assert.equal(host.intervals.length, 1)
})
