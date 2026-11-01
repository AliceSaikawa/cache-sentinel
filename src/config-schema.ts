/**
 * 設定画面用の Config スキーマ (#10)。キー・型・下限・既定値は `src/config.ts` の `CONFIG_KEYS` と `DEFAULTS` から作る。
 *
 * `@deepseek-ai/schemastery` は DSH が実行時に提供するもので、依存には入れない(docs/spike.md S1)。
 * 読み込めない環境(テスト・CI・DSH の外)では `ConfigSchema` は undefined になり、設定画面に項目が出ないだけで
 * プラグインの動作は変わらない(検証は `parseConfig` が行う)。
 * トップレベル await を使うので、ブラウザ向けのクライアント半分からは import しない。
 */
import { CONFIG_KEYS, DEFAULTS, type ConfigKeySpec } from './config.ts'
import { MODES } from './modes.ts'

/**
 * schemastery の、このプラグインが使う部分だけの形 (型定義を依存に持ち込まないため)。
 * 本物は `@deepseek-ai/schemastery`(DSH が実行時に提供する。docs/spike.md S1)。
 */
export interface SchemaNode {
  default(value: unknown): SchemaNode
  description(text: string): SchemaNode
  min(value: number): SchemaNode
  step(value: number): SchemaNode
  volatile(): SchemaNode
}

/** schemastery の既定エクスポート(`Schema`)のうち使う部分。 */
export interface SchemaFactory {
  object(dict: Record<string, SchemaNode>): SchemaNode
  union(list: readonly SchemaNode[]): SchemaNode
  const(value: string): SchemaNode
  number(): SchemaNode
  boolean(): SchemaNode
  string(): SchemaNode
}

/**
 * 各キーの説明(英語)。設定画面の文言はクライアントが表示言語で持つ(src/client/settings-page.ts)ので、
 * ここは `dsh --dump-config-schema` などスキーマを直接読む道具向け。
 */
const DESCRIPTIONS: Record<ConfigKeySpec['key'], string> = {
  mode: 'Default mode: block (reject sends), archive, both, or off. /sentinel can override it.',
  idleMinutes: 'Minutes since the last response after which sends are blocked (the archive threshold in archive mode).',
  archiveAfterMinutes: 'Archive threshold in minutes in both mode.',
  unlockTtlMinutes: 'Minutes an /unlock allowance stays valid.',
  checkIntervalSeconds: 'Seconds between archive checks.',
  skipPinned: 'Do not archive pinned sessions.',
  archiveExisting: 'Also archive sessions that stopped before archiving was first enabled.',
  maxPerCycle: 'Maximum number of sessions archived per check.',
  dryRun: 'Only log; neither block nor archive.',
  stateFile: 'Path of the state file. Defaults to $DSH_HOME/cache-sentinel/profiles/<profile>/state.json.',
}

/**
 * 設定画面用の Config スキーマを `CONFIG_KEYS` と `DEFAULTS` から組む (#10)。
 * - 整数は `number().step(1).min(下限)`(schemastery の `natural()` と同じ作り方で下限だけ変える)。
 * - `live` のキーは `.volatile()`。DSH の設定画面は volatile なキーだけを編集対象にする(docs/spike.md S2)。
 * - 未知キーの拒否とエラー文面の表示言語はスキーマでは表せないので `parseConfig` が受け持つ。
 * `z` を引数で受けるのは、schemastery の無い環境(テスト・CI)でも組み立て方を検査できるようにするため。
 */
export function buildConfigSchema(z: SchemaFactory): SchemaNode {
  const dict: Record<string, SchemaNode> = {}
  for (const spec of CONFIG_KEYS) {
    let node: SchemaNode
    switch (spec.kind) {
      case 'mode':
        node = z.union(MODES.map((mode) => z.const(mode))).default(DEFAULTS.mode)
        break
      case 'integer':
        node = z.number().step(1).min(spec.min).default(DEFAULTS[spec.key])
        break
      case 'boolean':
        node = z.boolean().default(DEFAULTS[spec.key])
        break
      case 'string':
        node = z.string()
        break
    }
    node = node.description(DESCRIPTIONS[spec.key])
    dict[spec.key] = spec.live ? node.volatile() : node
  }
  return z.object(dict)
}

/**
 * DSH が提供する `@deepseek-ai/schemastery` を読み込む。読めない環境(テスト・CI・DSH の外)では undefined。
 * 依存には入れず、ビルドでも `external: ['@deepseek-ai/*']` で外す(docs/spike.md S1)。
 */
export async function loadSchemaFactory(): Promise<SchemaFactory | undefined> {
  try {
    const specifier = '@deepseek-ai/schemastery'
    const mod = (await import(specifier)) as { default?: unknown }
    return typeof mod.default === 'function' ? (mod.default as unknown as SchemaFactory) : undefined
  } catch {
    return undefined
  }
}


/** DSH が `runtime.Config` として読むスキーマ。`src/index.ts` が `Config` の名前で export する。 */
export const ConfigSchema: SchemaNode | undefined = await (async () => {
  const z = await loadSchemaFactory()
  return z === undefined ? undefined : buildConfigSchema(z)
})()
