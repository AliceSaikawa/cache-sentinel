/**
 * ログ出力。DSH の `ctx.logger` は出力先(exporter)が組み込まれていないと記録が捨てられ、
 * journal にも残らない(T9 で確認)。他の DSH プラグインと同様に `[cache-sentinel]` 付きで
 * console にも書き、`journalctl --user -u deepseek-harness` で追えるようにする。
 * debug は量が多くなり得るので console には出さない。
 */
import type { CycleLogger } from './cycle.ts'

/** console のうち使う部分。テストで差し替えられるように引数で受け取る。 */
export interface ConsoleSink {
  log(message: string): void
  warn(message: string): void
}

export const LOG_PREFIX = '[cache-sentinel]'

/**
 * ctx.logger と console の両方に書くロガーを作る。
 * @param base - DSH の ctx.logger(exporter があればそちらにも残る)。
 * @param sink - console 相当。
 */
export function createLogger(base: CycleLogger, sink: ConsoleSink): CycleLogger {
  return {
    debug(message) {
      base.debug(message)
    },
    info(message) {
      base.info(message)
      sink.log(`${LOG_PREFIX} ${message}`)
    },
    warn(message) {
      base.warn(message)
      sink.warn(`${LOG_PREFIX} ${message}`)
    },
  }
}
