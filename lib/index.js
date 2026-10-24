// src/index.ts
import path2, { join as join3 } from "node:path";

// src/activity.ts
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
var LOG_FILENAME = /^session\.v\d+\.jsonl(\.zstd)?$/;
var ENCODED_CODE_UNIT = /~([0-9A-F]{4})/g;
function decodeSegment(name2) {
  return name2.replace(
    ENCODED_CODE_UNIT,
    (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16))
  );
}
async function readEntries(path3) {
  try {
    return await readdir(path3, { withFileTypes: true });
  } catch {
    return void 0;
  }
}
async function scanLogMtimes(sessionsRoot) {
  const index = /* @__PURE__ */ new Map();
  const projectDirs = await readEntries(sessionsRoot);
  if (projectDirs === void 0) {
    return index;
  }
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const projectPath = join(sessionsRoot, projectDir.name);
    const sessionDirs = await readEntries(projectPath);
    if (sessionDirs === void 0) continue;
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue;
      const id = decodeSegment(sessionDir.name);
      const sessionPath = join(projectPath, sessionDir.name);
      const files = await readEntries(sessionPath);
      if (files === void 0) continue;
      for (const file of files) {
        if (!file.isFile() || !LOG_FILENAME.test(file.name)) continue;
        let mtimeMs;
        try {
          mtimeMs = (await stat(join(sessionPath, file.name))).mtimeMs;
        } catch {
          continue;
        }
        const prev = index.get(id);
        if (prev === void 0 || mtimeMs > prev) {
          index.set(id, mtimeMs);
        }
      }
    }
  }
  return index;
}

// src/archive.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";
function resolveHome(env = process.env) {
  const override = env.DSH_HOME?.trim();
  return override ? override : join2(homedir(), ".dsh");
}
function isActiveSessionError(error) {
  if (!(error instanceof Error)) return false;
  if (error.constructor?.name === "WorkspaceActiveSessionError") return true;
  const shaped = error;
  return typeof shaped.sessionId === "string" && Array.isArray(shaped.activity);
}
function liveLastEventTime(services, id) {
  const events = services.sessions.get(id)?.ownEvents();
  if (events === void 0 || events.length === 0) return void 0;
  const time = events[events.length - 1]?.time;
  return typeof time === "number" && Number.isFinite(time) ? time : void 0;
}
function createDeps(services, scan, log, now = Date.now) {
  return {
    now,
    archivedIds: () => services.workspaceRegistry.archivedSessionIds,
    archive: (id) => services.workspaceRegistry.archiveSession(id),
    isActiveError: isActiveSessionError,
    log,
    async listSessions() {
      const [snapshots, mtimes] = await Promise.all([services.sessionPersistence.list(), scan()]);
      const archived = new Set(services.workspaceRegistry.archivedSessionIds);
      const pinned = new Set(services.workspaceRegistry.pinnedSessionIds);
      return snapshots.map(({ header }) => {
        const candidates = [mtimes.get(header.id), liveLastEventTime(services, header.id)].filter(
          (value) => value !== void 0
        );
        const info = {
          id: header.id,
          createdAt: header.createdAt,
          pinned: pinned.has(header.id),
          archived: archived.has(header.id)
        };
        if (candidates.length > 0) info.lastActivityAt = Math.max(...candidates);
        if (header.origin !== void 0) info.origin = header.origin;
        if (header.parentSession !== void 0) info.parentSession = header.parentSession;
        return info;
      });
    }
  };
}

// src/gate.ts
function classifyStep(step, sourceKinds) {
  if (step > 1) return "mid-turn";
  return sourceKinds.includes("user") ? "user-send" : "other-input";
}
function elapsedMs(now, lastResponseAt) {
  return Math.max(0, now - lastResponseAt);
}
function isGrantValid(input) {
  const { now, lastResponseAt, grantedAt, unlockTtlMinutes } = input;
  if (grantedAt === void 0) {
    return false;
  }
  if (now - grantedAt > unlockTtlMinutes * 6e4) {
    return false;
  }
  if (lastResponseAt !== void 0 && lastResponseAt >= grantedAt) {
    return false;
  }
  return true;
}
function decideGate(input) {
  const { now, lastResponseAt, idleMinutes, grantedAt, unlockTtlMinutes, stepKind } = input;
  if (lastResponseAt === void 0) {
    return { kind: "pass", reason: "no-response" };
  }
  const idle = elapsedMs(now, lastResponseAt);
  if (idle <= idleMinutes * 6e4) {
    return { kind: "pass", reason: "fresh" };
  }
  if (stepKind !== "user-send") {
    return { kind: "pass", reason: stepKind };
  }
  if (isGrantValid({ now, lastResponseAt, grantedAt, unlockTtlMinutes })) {
    return { kind: "pass", reason: "unlocked" };
  }
  return { kind: "block", idleMs: idle };
}

// src/last-response.ts
var RESPONSE_EVENT_TYPE = "step/end";
function findLastResponseAt(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event === void 0) continue;
    if (event.type !== RESPONSE_EVENT_TYPE) continue;
    if (!Number.isFinite(event.time)) continue;
    return event.time;
  }
  return void 0;
}
function resolveLastResponseAt(inherited, view) {
  if (view.ownEvents === void 0) return findLastResponseAt(inherited);
  const own = findLastResponseAt(view.ownEvents);
  const createdAt = Number.isFinite(view.createdAt) ? view.createdAt : void 0;
  if (own === void 0) return createdAt;
  if (createdAt === void 0) return own;
  return Math.max(own, createdAt);
}
var LastResponseTracker = class {
  /** セッション id → 最終応答時刻。undefined も「取得済みで応答なし」として保持する。 */
  cache = /* @__PURE__ */ new Map();
  /** セッションのイベント列と見え方を返す。取得できなければ undefined。 */
  load;
  /**
   * @param load - セッションのイベント列と見え方を返す。取得できなければ undefined。
   */
  constructor(load) {
    this.load = load;
  }
  /**
   * キャッシュにあればそれを返す。なければ `load` して `resolveLastResponseAt` の結果をキャッシュする。
   * `load` が undefined を返した場合と例外を投げた場合は、キャッシュせずそのまま返す / 伝播する。
   */
  get(sessionId) {
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId);
    }
    const loaded = this.load(sessionId);
    if (loaded === void 0) {
      return void 0;
    }
    const lastResponseAt = resolveLastResponseAt(loaded.events, loaded.view);
    this.cache.set(sessionId, lastResponseAt);
    return lastResponseAt;
  }
  /**
   * `step/end` の観測をキャッシュに反映する。キャッシュ値より新しいときだけ更新し、
   * 未登録のセッションでも登録する。それ以外のイベントは無視する。
   */
  observe(sessionId, event) {
    if (event.type !== RESPONSE_EVENT_TYPE) return;
    if (!Number.isFinite(event.time)) return;
    const cached = this.cache.get(sessionId);
    if (cached !== void 0 && event.time <= cached) return;
    this.cache.set(sessionId, event.time);
  }
  /** セッションのキャッシュを捨てる。次回の `get` は再び `load` を呼ぶ。 */
  forget(sessionId) {
    this.cache.delete(sessionId);
  }
};

// src/messages.ts
var en = {
  noticeBlocked: (idleMinutes) => `Send blocked (${idleMinutes} minutes since the last response, as the cache has likely expired).`,
  noticeUnlockHint: "You can allow the next single send with /unlock.",
  noticeDiscarded: "Discarded input:",
  noticeOmitted: "\u2026(truncated)",
  noticeAttachments: (count) => `(${count} non-text attachments such as images were also discarded)`,
  unlockLabel: "Allow the next single send (/unlock)",
  bannerStale: (idleMinutes) => `Cache expired (${idleMinutes} minutes since the last response). Sending now will be blocked.`,
  bannerStaleNoIdle: "Cache expired. Sending now will be blocked.",
  bannerUnlocked: "Next send allowed (uncached input rates will apply).",
  bannerUnlockedRemaining: (remainingMinutes) => `Next send allowed (uncached input rates will apply). ${remainingMinutes} min left`,
  bannerUnlockFailed: (detail) => `Could not run /unlock (${detail}). Send /unlock from the input box instead.`,
  bannerUnlockNotFound: "/unlock was not found. The cache-sentinel host plugin may not be running.",
  modeLineFromCommand: (mode, configMode) => `cache-sentinel: mode ${mode} (set with /sentinel, YAML default is ${configMode})`,
  modeLineFromConfig: (mode) => `cache-sentinel: mode ${mode} (from YAML)`,
  modeBlock: (idleMinutes, unlockTtlMinutes) => `Input blocked after ${idleMinutes} minutes since the last response (cleared with /unlock, valid for ${unlockTtlMinutes} minutes)`,
  modeArchive: (idleMinutes) => `Archived after ${idleMinutes} minutes since the last response`,
  modeBoth: (idleMinutes, archiveAfterMinutes) => `Input blocked after ${idleMinutes} minutes, archived after ${archiveAfterMinutes} minutes`,
  modeOff: "Disabled (does nothing)",
  modeSessionNoResponse: "This session: no model response yet",
  modeSession: (sessionIdleMinutes) => `This session: ${sessionIdleMinutes} minutes since the last response`,
  modeDryRun: "dryRun: no blocking or archiving, logging only",
  sentinelUsage: "Usage: /sentinel [block|archive|both|off|default] (with no argument, show status)",
  unlockInactive: (mode) => `Input blocking is disabled (mode: ${mode})`,
  unlockGranted: (idleMinutes, ttlMinutes) => `Allowed the next send. ${idleMinutes} minutes have passed since the last response, so uncached input rates apply (valid for ${ttlMinutes} minutes)`,
  unlockFresh: (idleMinutes) => `${idleMinutes} minutes since the last response. The cache is still valid, so you can send as is`,
  unlockNoResponse: "This session has no model response yet",
  configNotObject: "Config must be an object",
  configUnknownKey: (key) => `Config has an unknown key: ${key}`,
  configNotNumber: (key) => `Config key ${key} must be a number`,
  configNotInteger: (key) => `Config key ${key} must be a finite integer`,
  configBelowMinimum: (key, min) => `Config key ${key} must be at least ${min}`,
  configNotBoolean: (key) => `Config key ${key} must be a boolean`,
  configNotString: (key) => `Config key ${key} must be a string`,
  configInvalidMode: (modes) => `Config key mode must be one of ${modes}`,
  commandUnlockDescription: "Allow the next send in a session where sending is blocked because the cache expired (cache-sentinel)",
  commandSentinelDescription: "Show cache-sentinel status and switch mode: /sentinel [block|archive|both|off|default]",
  commandSentinelInputHint: "[block|archive|both|off|default]"
};
var ja = {
  noticeBlocked: (idleMinutes) => `\u9001\u4FE1\u3092\u6B62\u3081\u307E\u3057\u305F(\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206\u3002\u30AD\u30E3\u30C3\u30B7\u30E5\u304C\u5207\u308C\u3066\u3044\u308B\u53EF\u80FD\u6027\u304C\u9AD8\u3044\u305F\u3081)\u3002`,
  noticeUnlockHint: "/unlock \u3067\u6B21\u306E 1 \u56DE\u3092\u8A31\u53EF\u3067\u304D\u307E\u3059\u3002",
  noticeDiscarded: "\u7834\u68C4\u3055\u308C\u305F\u5165\u529B:",
  noticeOmitted: "\u2026(\u4EE5\u4E0B\u7701\u7565)",
  noticeAttachments: (count) => `(\u753B\u50CF\u306A\u3069\u30C6\u30AD\u30B9\u30C8\u4EE5\u5916\u306E\u6DFB\u4ED8 ${count} \u4EF6\u3082\u7834\u68C4\u3055\u308C\u307E\u3057\u305F)`,
  unlockLabel: "\u6B21\u306E 1 \u56DE\u3092\u8A31\u53EF(/unlock)",
  bannerStale: (idleMinutes) => `\u30AD\u30E3\u30C3\u30B7\u30E5\u5207\u308C(\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206)\u3002\u3053\u306E\u307E\u307E\u9001\u308B\u3068\u6B62\u3081\u3089\u308C\u307E\u3059\u3002`,
  bannerStaleNoIdle: "\u30AD\u30E3\u30C3\u30B7\u30E5\u5207\u308C\u3002\u3053\u306E\u307E\u307E\u9001\u308B\u3068\u6B62\u3081\u3089\u308C\u307E\u3059\u3002",
  bannerUnlocked: "\u6B21\u306E\u9001\u4FE1\u3092\u8A31\u53EF\u4E2D(\u30AD\u30E3\u30C3\u30B7\u30E5\u306A\u3057\u306E\u6599\u91D1\u306B\u306A\u308A\u307E\u3059)\u3002",
  bannerUnlockedRemaining: (remainingMinutes) => `\u6B21\u306E\u9001\u4FE1\u3092\u8A31\u53EF\u4E2D(\u30AD\u30E3\u30C3\u30B7\u30E5\u306A\u3057\u306E\u6599\u91D1\u306B\u306A\u308A\u307E\u3059)\u3002\u3042\u3068 ${remainingMinutes} \u5206`,
  bannerUnlockFailed: (detail) => `/unlock \u3092\u5B9F\u884C\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F(${detail})\u3002\u5165\u529B\u6B04\u304B\u3089 /unlock \u3092\u9001\u3063\u3066\u304F\u3060\u3055\u3044\u3002`,
  bannerUnlockNotFound: "/unlock \u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002cache-sentinel \u306E Host \u5074\u304C\u52D5\u3044\u3066\u3044\u306A\u3044\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002",
  modeLineFromCommand: (mode, configMode) => `cache-sentinel: \u30E2\u30FC\u30C9 ${mode}(/sentinel \u3067\u8A2D\u5B9A\u3001YAML \u306E\u65E2\u5B9A\u306F ${configMode})`,
  modeLineFromConfig: (mode) => `cache-sentinel: \u30E2\u30FC\u30C9 ${mode}(YAML \u306E\u8A2D\u5B9A)`,
  modeBlock: (idleMinutes, unlockTtlMinutes) => `\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206\u3067\u5165\u529B\u7981\u6B62(/unlock \u3067\u89E3\u9664\u3001${unlockTtlMinutes} \u5206\u6709\u52B9)`,
  modeArchive: (idleMinutes) => `\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206\u3067\u30A2\u30FC\u30AB\u30A4\u30D6`,
  modeBoth: (idleMinutes, archiveAfterMinutes) => `${idleMinutes} \u5206\u3067\u5165\u529B\u7981\u6B62\u3001${archiveAfterMinutes} \u5206\u3067\u30A2\u30FC\u30AB\u30A4\u30D6`,
  modeOff: "\u505C\u6B62\u4E2D(\u4F55\u3082\u3057\u307E\u305B\u3093)",
  modeSessionNoResponse: "\u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3: \u307E\u3060\u30E2\u30C7\u30EB\u5FDC\u7B54\u304C\u3042\u308A\u307E\u305B\u3093",
  modeSession: (sessionIdleMinutes) => `\u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3: \u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${sessionIdleMinutes} \u5206`,
  modeDryRun: "dryRun: \u30D6\u30ED\u30C3\u30AF\u3082\u30A2\u30FC\u30AB\u30A4\u30D6\u3082\u305B\u305A\u30ED\u30B0\u306E\u307F",
  sentinelUsage: "\u4F7F\u3044\u65B9: /sentinel [block|archive|both|off|default](\u5F15\u6570\u306A\u3057\u3067\u72B6\u614B\u8868\u793A)",
  unlockInactive: (mode) => `\u5165\u529B\u7981\u6B62\u306F\u7121\u52B9\u3067\u3059(\u30E2\u30FC\u30C9: ${mode})`,
  unlockGranted: (idleMinutes, ttlMinutes) => `\u6B21\u306E\u9001\u4FE1\u3092\u8A31\u53EF\u3057\u307E\u3057\u305F\u3002\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206\u7D4C\u904E\u3057\u3066\u3044\u308B\u305F\u3081\u3001\u30AD\u30E3\u30C3\u30B7\u30E5\u306A\u3057\u306E\u6599\u91D1\u306B\u306A\u308A\u307E\u3059(\u8A31\u53EF\u306F ${ttlMinutes} \u5206\u6709\u52B9)`,
  unlockFresh: (idleMinutes) => `\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206\u3067\u3059\u3002\u30AD\u30E3\u30C3\u30B7\u30E5\u306F\u6709\u52B9\u306A\u306E\u3067\u305D\u306E\u307E\u307E\u9001\u4FE1\u3067\u304D\u307E\u3059`,
  unlockNoResponse: "\u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u306F\u307E\u3060\u30E2\u30C7\u30EB\u5FDC\u7B54\u304C\u3042\u308A\u307E\u305B\u3093",
  configNotObject: "\u8A2D\u5B9A\u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044",
  configUnknownKey: (key) => `\u8A2D\u5B9A\u306B\u672A\u77E5\u306E\u30AD\u30FC\u304C\u3042\u308A\u307E\u3059: ${key}`,
  configNotNumber: (key) => `\u8A2D\u5B9A ${key} \u306F\u6570\u5024\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  configNotInteger: (key) => `\u8A2D\u5B9A ${key} \u306F\u6709\u9650\u306E\u6574\u6570\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  configBelowMinimum: (key, min) => `\u8A2D\u5B9A ${key} \u306F ${min} \u4EE5\u4E0A\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  configNotBoolean: (key) => `\u8A2D\u5B9A ${key} \u306F boolean \u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  configNotString: (key) => `\u8A2D\u5B9A ${key} \u306F\u6587\u5B57\u5217\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  configInvalidMode: (modes) => `\u8A2D\u5B9A mode \u306F ${modes} \u306E\u3044\u305A\u308C\u304B\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  commandUnlockDescription: "\u30AD\u30E3\u30C3\u30B7\u30E5\u5207\u308C\u3067\u5165\u529B\u7981\u6B62\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u3001\u6B21\u306E\u9001\u4FE1\u3092\u8A31\u53EF\u3059\u308B(cache-sentinel)",
  commandSentinelDescription: "cache-sentinel \u306E\u72B6\u614B\u8868\u793A\u3068\u30E2\u30FC\u30C9\u5207\u308A\u66FF\u3048: /sentinel [block|archive|both|off|default]",
  commandSentinelInputHint: "[block|archive|both|off|default]"
};
var zhCN = {
  noticeBlocked: (idleMinutes) => `\u5DF2\u963B\u6B62\u53D1\u9001(\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94 ${idleMinutes} \u5206\u949F\uFF0C\u56E0\u4E3A\u7F13\u5B58\u5F88\u53EF\u80FD\u5DF2\u8FC7\u671F)\u3002`,
  noticeUnlockHint: "\u53EF\u7528 /unlock \u5141\u8BB8\u4E0B 1 \u6B21\u53D1\u9001\u3002",
  noticeDiscarded: "\u5DF2\u4E22\u5F03\u7684\u8F93\u5165\uFF1A",
  noticeOmitted: "\u2026(\u4EE5\u4E0B\u7701\u7565)",
  noticeAttachments: (count) => `(\u53E6\u6709 ${count} \u6761\u56FE\u7247\u7B49\u975E\u6587\u672C\u9644\u4EF6\u88AB\u4E22\u5F03)`,
  unlockLabel: "\u5141\u8BB8\u4E0B 1 \u6B21\u53D1\u9001(/unlock)",
  bannerStale: (idleMinutes) => `\u7F13\u5B58\u5DF2\u8FC7\u671F(\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94 ${idleMinutes} \u5206\u949F)\u3002\u76F4\u63A5\u53D1\u9001\u5C06\u88AB\u963B\u6B62\u3002`,
  bannerStaleNoIdle: "\u7F13\u5B58\u5DF2\u8FC7\u671F\u3002\u76F4\u63A5\u53D1\u9001\u5C06\u88AB\u963B\u6B62\u3002",
  bannerUnlocked: "\u6B63\u5141\u8BB8\u4E0B\u4E00\u6B21\u53D1\u9001(\u5C06\u6309\u65E0\u7F13\u5B58\u4EF7\u683C\u8BA1\u8D39)\u3002",
  bannerUnlockedRemaining: (remainingMinutes) => `\u6B63\u5141\u8BB8\u4E0B\u4E00\u6B21\u53D1\u9001(\u5C06\u6309\u65E0\u7F13\u5B58\u4EF7\u683C\u8BA1\u8D39)\u3002\u5269\u4F59 ${remainingMinutes} \u5206\u949F`,
  bannerUnlockFailed: (detail) => `\u65E0\u6CD5\u6267\u884C /unlock(${detail})\u3002\u8BF7\u5728\u8F93\u5165\u6846\u4E2D\u53D1\u9001 /unlock\u3002`,
  bannerUnlockNotFound: "\u627E\u4E0D\u5230 /unlock\u3002cache-sentinel \u7684 Host \u7AEF\u53EF\u80FD\u672A\u5728\u8FD0\u884C\u3002",
  modeLineFromCommand: (mode, configMode) => `cache-sentinel\uFF1A\u6A21\u5F0F ${mode}(\u901A\u8FC7 /sentinel \u8BBE\u7F6E\uFF0CYAML \u9ED8\u8BA4\u4E3A ${configMode})`,
  modeLineFromConfig: (mode) => `cache-sentinel\uFF1A\u6A21\u5F0F ${mode}(YAML \u8BBE\u7F6E)`,
  modeBlock: (idleMinutes, unlockTtlMinutes) => `\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94 ${idleMinutes} \u5206\u949F\u540E\u7981\u6B62\u8F93\u5165(\u7528 /unlock \u89E3\u9664\uFF0C${unlockTtlMinutes} \u5206\u949F\u5185\u6709\u6548)`,
  modeArchive: (idleMinutes) => `\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94 ${idleMinutes} \u5206\u949F\u540E\u5F52\u6863`,
  modeBoth: (idleMinutes, archiveAfterMinutes) => `${idleMinutes} \u5206\u949F\u540E\u7981\u6B62\u8F93\u5165\uFF0C${archiveAfterMinutes} \u5206\u949F\u540E\u5F52\u6863`,
  modeOff: "\u5DF2\u505C\u6B62(\u4E0D\u505A\u4EFB\u4F55\u64CD\u4F5C)",
  modeSessionNoResponse: "\u672C\u4F1A\u8BDD\uFF1A\u5C1A\u65E0\u6A21\u578B\u54CD\u5E94",
  modeSession: (sessionIdleMinutes) => `\u672C\u4F1A\u8BDD\uFF1A\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94 ${sessionIdleMinutes} \u5206\u949F`,
  modeDryRun: "dryRun\uFF1A\u4E0D\u963B\u6B62\u4E5F\u4E0D\u5F52\u6863\uFF0C\u4EC5\u8BB0\u5F55\u65E5\u5FD7",
  sentinelUsage: "\u7528\u6CD5\uFF1A/sentinel [block|archive|both|off|default](\u4E0D\u5E26\u53C2\u6570\u65F6\u663E\u793A\u72B6\u6001)",
  unlockInactive: (mode) => `\u8F93\u5165\u7981\u6B62\u5DF2\u7981\u7528(\u6A21\u5F0F\uFF1A${mode})`,
  unlockGranted: (idleMinutes, ttlMinutes) => `\u5DF2\u5141\u8BB8\u4E0B\u4E00\u6B21\u53D1\u9001\u3002\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94\u5DF2\u8FC7 ${idleMinutes} \u5206\u949F\uFF0C\u56E0\u6B64\u5C06\u6309\u65E0\u7F13\u5B58\u4EF7\u683C\u8BA1\u8D39(\u8BB8\u53EF ${ttlMinutes} \u5206\u949F\u5185\u6709\u6548)`,
  unlockFresh: (idleMinutes) => `\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94 ${idleMinutes} \u5206\u949F\u3002\u7F13\u5B58\u4ECD\u6709\u6548\uFF0C\u53EF\u76F4\u63A5\u53D1\u9001`,
  unlockNoResponse: "\u672C\u4F1A\u8BDD\u5C1A\u65E0\u6A21\u578B\u54CD\u5E94",
  configNotObject: "\u914D\u7F6E\u5FC5\u987B\u662F\u5BF9\u8C61",
  configUnknownKey: (key) => `\u914D\u7F6E\u4E2D\u6709\u672A\u77E5\u7684\u952E\uFF1A${key}`,
  configNotNumber: (key) => `\u914D\u7F6E ${key} \u5FC5\u987B\u6307\u5B9A\u4E3A\u6570\u5B57`,
  configNotInteger: (key) => `\u914D\u7F6E ${key} \u5FC5\u987B\u6307\u5B9A\u4E3A\u6709\u9650\u6574\u6570`,
  configBelowMinimum: (key, min) => `\u914D\u7F6E ${key} \u5FC5\u987B\u4E3A ${min} \u4EE5\u4E0A`,
  configNotBoolean: (key) => `\u914D\u7F6E ${key} \u5FC5\u987B\u6307\u5B9A\u4E3A boolean`,
  configNotString: (key) => `\u914D\u7F6E ${key} \u5FC5\u987B\u6307\u5B9A\u4E3A\u5B57\u7B26\u4E32`,
  configInvalidMode: (modes) => `\u914D\u7F6E mode \u5FC5\u987B\u4E3A ${modes} \u4E4B\u4E00`,
  commandUnlockDescription: "\u5728\u56E0\u7F13\u5B58\u8FC7\u671F\u800C\u7981\u6B62\u53D1\u9001\u7684\u4F1A\u8BDD\u4E2D\uFF0C\u5141\u8BB8\u4E0B\u4E00\u6B21\u53D1\u9001(cache-sentinel)",
  commandSentinelDescription: "\u663E\u793A cache-sentinel \u72B6\u6001\u5E76\u5207\u6362\u6A21\u5F0F\uFF1A/sentinel [block|archive|both|off|default]",
  commandSentinelInputHint: "[block|archive|both|off|default]"
};
var MESSAGES = {
  en,
  ja,
  "zh-CN": zhCN
};

// src/notice.ts
var NOTICE_TEXT_LIMIT = 2e3;
var NOTICE_DEDUPE_INTERVAL_MS = 10 * 6e4;
function truncate(text, omitted) {
  return text.length > NOTICE_TEXT_LIMIT ? text.slice(0, NOTICE_TEXT_LIMIT) + omitted : text;
}
function textOf(message) {
  let joined = "";
  for (const block of message.content) {
    if (block.type !== "text") continue;
    if (typeof block.text !== "string") continue;
    joined += block.text;
  }
  return joined;
}
function discardedPart(messages, m) {
  const lines = [];
  const entries = [];
  let attachments = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== "text") attachments++;
    }
    const text = textOf(message);
    if (text !== "") entries.push(truncate(text, m.noticeOmitted));
  }
  if (entries.length > 0) {
    lines.push(m.noticeDiscarded);
    lines.push(entries.join("\n\n"));
  }
  if (attachments >= 1) {
    lines.push(m.noticeAttachments(attachments));
  }
  return lines.join("\n");
}
function buildBlockNotice(input, locale) {
  const m = MESSAGES[locale];
  const head = [m.noticeBlocked(input.idleMinutes), m.noticeUnlockHint].join("\n");
  const body = discardedPart(input.messages, m);
  return body === "" ? head : `${head}
${body}`;
}
function noticeDedupeKey(messages, locale) {
  return discardedPart(messages, MESSAGES[locale]);
}
var NoticeDedupe = class {
  /** セッション id → 最後に出した文面と時刻。 */
  lastSent = /* @__PURE__ */ new Map();
  intervalMs;
  /** @param intervalMs - 同じ文面を再び出すまでの最短間隔 (ミリ秒)。 */
  constructor(intervalMs) {
    this.intervalMs = intervalMs;
  }
  /** 保持している記録の数。 */
  get size() {
    return this.lastSent.size;
  }
  /**
   * その文面を今出してよいかを返す。記録は変えない。
   * - 未通知のセッション、または文面が直前と違う → true。
   * - 直前と同じ文面 → 最後に出してから `intervalMs` 未満なら false。
   *   ちょうど `intervalMs` の経過と、時計巻き戻り (負の経過) は true。
   */
  shouldSend(sessionId, now, text) {
    const last = this.lastSent.get(sessionId);
    if (last === void 0 || last.text !== text) return true;
    const elapsed = now - last.at;
    return !(elapsed >= 0 && elapsed < this.intervalMs);
  }
  /** 会話に出した文面と時刻を、そのセッションの「最後に出した通知」として記録する。 */
  record(sessionId, now, text) {
    this.lastSent.set(sessionId, { text, at: now });
  }
  /** そのセッションの記録を消す。次の通知は文面に関わらず出る。 */
  forget(sessionId) {
    this.lastSent.delete(sessionId);
  }
  /**
   * 判定に効かなくなった記録を消す。`now - at >= intervalMs` のものを消す。
   * 時計巻き戻り (負の経過) の記録は、時計が追いつけばまた効くので残す。
   */
  prune(now) {
    for (const [sessionId, last] of this.lastSent) {
      if (now - last.at >= this.intervalMs) {
        this.lastSent.delete(sessionId);
      }
    }
  }
};

// src/status.ts
function elapsedMs2(now, lastResponseAt) {
  return Math.max(0, now - lastResponseAt);
}
function elapsedMinutes(now, lastResponseAt) {
  return Math.floor(elapsedMs2(now, lastResponseAt) / 6e4);
}
function computeStatus(input) {
  const {
    mode,
    gate,
    known,
    now,
    lastResponseAt,
    idleMinutes,
    grantedAt,
    unlockTtlMinutes,
    dryRun
  } = input;
  const thresholdMinutes = idleMinutes;
  if (!gate) {
    const idle2 = known && lastResponseAt !== void 0 ? elapsedMinutes(now, lastResponseAt) : null;
    return {
      mode,
      gate,
      state: "inactive",
      idleMinutes: idle2,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun
    };
  }
  if (!known) {
    return {
      mode,
      gate,
      state: "unknown",
      idleMinutes: null,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun
    };
  }
  if (lastResponseAt === void 0) {
    return {
      mode,
      gate,
      state: "no-response",
      idleMinutes: null,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun
    };
  }
  const idle = elapsedMinutes(now, lastResponseAt);
  if (elapsedMs2(now, lastResponseAt) <= idleMinutes * 6e4) {
    return {
      mode,
      gate,
      state: "fresh",
      idleMinutes: idle,
      thresholdMinutes,
      unlockExpiresAt: null,
      dryRun
    };
  }
  if (grantedAt !== void 0 && isGrantValid({ now, lastResponseAt, grantedAt, unlockTtlMinutes })) {
    return {
      mode,
      gate,
      state: "unlocked",
      idleMinutes: idle,
      thresholdMinutes,
      unlockExpiresAt: grantedAt + unlockTtlMinutes * 6e4,
      dryRun
    };
  }
  return {
    mode,
    gate,
    state: "stale",
    idleMinutes: idle,
    thresholdMinutes,
    unlockExpiresAt: null,
    dryRun
  };
}

// src/unlock.ts
var UnlockStore = class {
  grants = /* @__PURE__ */ new Map();
  /** 許可を記録する。既に許可があれば上書きする(spec §4: grantedAt = now)。 */
  grant(sessionId, now) {
    this.grants.set(sessionId, now);
  }
  /** 許可時刻を返す。無ければ undefined。 */
  grantedAt(sessionId) {
    return this.grants.get(sessionId);
  }
  /** 許可を取り消す。無いセッションに対しては何もしない。 */
  revoke(sessionId) {
    this.grants.delete(sessionId);
  }
  /**
   * TTL を過ぎた許可を削除する。`now - grantedAt > ttlMs` のものを消す。
   * 境界ちょうど(`now - grantedAt === ttlMs`)は残す。時計巻き戻り(負の経過)も残す。
   */
  prune(now, ttlMs) {
    for (const [sessionId, grantedAt] of this.grants) {
      if (now - grantedAt > ttlMs) {
        this.grants.delete(sessionId);
      }
    }
  }
};
function decideUnlock(input) {
  const { now, lastResponseAt, idleMinutes, unlockTtlMinutes } = input;
  if (lastResponseAt === void 0) {
    return { kind: "no-response" };
  }
  const elapsed = Math.max(0, now - lastResponseAt);
  const elapsedMinutes2 = Math.floor(elapsed / 6e4);
  if (elapsed <= idleMinutes * 6e4) {
    return { kind: "fresh", idleMinutes: elapsedMinutes2 };
  }
  return { kind: "granted", idleMinutes: elapsedMinutes2, ttlMinutes: unlockTtlMinutes };
}
function unlockMessage(outcome, locale) {
  const m = MESSAGES[locale];
  switch (outcome.kind) {
    case "granted":
      return m.unlockGranted(outcome.idleMinutes, outcome.ttlMinutes);
    case "fresh":
      return m.unlockFresh(outcome.idleMinutes);
    case "no-response":
      return m.unlockNoResponse;
  }
}

// src/block.ts
function sessionViewOf(session) {
  if (session.header?.origin !== "subagent" || session.header.isSeeded !== true) return {};
  return {
    ownEvents: session.ownEvents?.() ?? session.snapshotEvents(),
    createdAt: session.header.createdAt
  };
}
function createSentinel(config, log, locale, now = Date.now, isActive = () => true) {
  let loading;
  const tracker = new LastResponseTracker((id) => {
    if (loading?.id !== id) return void 0;
    const session = loading;
    return { events: session.snapshotEvents(), view: sessionViewOf(session) };
  });
  const unlocks = new UnlockStore();
  const dedupe = new NoticeDedupe(NOTICE_DEDUPE_INTERVAL_MS);
  const ttlMs = config.unlockTtlMinutes * 6e4;
  let noticeCounter = 0;
  const notify = (session, idleMinutes, messages) => {
    if (session.append === void 0) return;
    const at = now();
    const key = noticeDedupeKey(messages, locale);
    if (!dedupe.shouldSend(session.id, at, key)) {
      log.info(`\u540C\u3058\u6587\u9762\u306E\u30D6\u30ED\u30C3\u30AF\u901A\u77E5\u3092\u6291\u3048\u307E\u3057\u305F: ${session.id} (\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206)`);
      return;
    }
    const commandId = `cache-sentinel-${session.id}-${at}-${++noticeCounter}`;
    try {
      session.append("command/run", { commandId, name: "cache-sentinel", args: "", source: { kind: "user" } });
      session.append("command/done", {
        commandId,
        kind: "error",
        text: buildBlockNotice({ idleMinutes, messages }, locale)
      });
      dedupe.record(session.id, at, key);
    } catch (error) {
      log.warn(`\u30D6\u30ED\u30C3\u30AF\u901A\u77E5\u3092\u4F1A\u8A71\u306B\u8FFD\u52A0\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ${session.id}: ${String(error)}`);
    }
  };
  const lastResponseOf = (session) => {
    loading = session;
    try {
      return tracker.get(session.id);
    } finally {
      loading = void 0;
    }
  };
  return {
    async onPreStep(payload, next) {
      if (!isActive()) return next();
      const session = payload.agent.session;
      let decision;
      let sourceKinds;
      let stepKind;
      try {
        const at = now();
        unlocks.prune(at, ttlMs);
        dedupe.prune(at);
        sourceKinds = payload.messages.map((message) => message.source?.kind ?? "(source \u306A\u3057)");
        stepKind = classifyStep(payload.step, sourceKinds);
        decision = decideGate({
          now: at,
          lastResponseAt: lastResponseOf(session),
          idleMinutes: config.idleMinutes,
          grantedAt: unlocks.grantedAt(session.id),
          unlockTtlMinutes: config.unlockTtlMinutes,
          stepKind
        });
      } catch (error) {
        log.warn(`\u5224\u5B9A\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u901A\u3057\u307E\u3059: ${session.id}: ${String(error)}`);
        return next();
      }
      const position = `turn ${payload.turn} step ${payload.step}`;
      if (decision.kind === "pass") {
        if (stepKind === "user-send" && (decision.reason === "fresh" || decision.reason === "unlocked")) {
          dedupe.forget(session.id);
        }
        switch (decision.reason) {
          case "unlocked":
            log.info(`/unlock \u306E\u8A31\u53EF\u3067\u901A\u3057\u307E\u3057\u305F: ${session.id}`);
            break;
          case "mid-turn":
            log.info(`\u5931\u52B9\u3057\u3066\u3044\u307E\u3059\u304C\u30BF\u30FC\u30F3\u306E\u9014\u4E2D\u306A\u306E\u3067\u901A\u3057\u307E\u3057\u305F: ${session.id} (${position})`);
            break;
          case "other-input": {
            const sources = sourceKinds.length === 0 ? "\u306A\u3057" : sourceKinds.join(", ");
            log.info(`\u5931\u52B9\u3057\u3066\u3044\u307E\u3059\u304C\u30E6\u30FC\u30B6\u30FC\u306E\u9001\u4FE1\u3067\u306F\u306A\u3044\u306E\u3067\u901A\u3057\u307E\u3057\u305F: ${session.id} (${position}, \u5165\u529B: ${sources})`);
            break;
          }
        }
        return next();
      }
      const minutes = Math.floor(decision.idleMs / 6e4);
      const where = `${session.id} (\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${minutes} \u5206, ${position})`;
      if (config.dryRun) {
        log.info(`dryRun: \u30D6\u30ED\u30C3\u30AF\u5BFE\u8C61 ${where}`);
        return next();
      }
      log.info(`\u30D6\u30ED\u30C3\u30AF\u3057\u307E\u3057\u305F: ${where}\u3002/unlock \u3067\u6B21\u306E\u9001\u4FE1\u3092\u8A31\u53EF\u3067\u304D\u307E\u3059`);
      notify(session, minutes, payload.messages);
      return { kind: "reject" };
    },
    onSessionEvent(session, event) {
      tracker.observe(session.id, event);
    },
    unlock(agent, inactiveText) {
      if (!isActive()) return { kind: "success", text: inactiveText };
      const session = agent.session;
      const at = now();
      const outcome = decideUnlock({
        now: at,
        lastResponseAt: lastResponseOf(session),
        idleMinutes: config.idleMinutes,
        unlockTtlMinutes: config.unlockTtlMinutes
      });
      if (outcome.kind === "granted") {
        unlocks.grant(session.id, at);
        log.info(`/unlock \u3092\u8A31\u53EF\u3057\u307E\u3057\u305F: ${session.id} (\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${outcome.idleMinutes} \u5206)`);
      }
      return { kind: "success", text: unlockMessage(outcome, locale) };
    },
    idleMinutesOf(session) {
      const last = lastResponseOf(session);
      return last === void 0 ? void 0 : Math.floor(Math.max(0, now() - last) / 6e4);
    },
    statusOf(session, mode) {
      const at = now();
      unlocks.prune(at, ttlMs);
      return computeStatus({
        mode,
        gate: isActive(),
        known: session !== void 0,
        now: at,
        lastResponseAt: session === void 0 ? void 0 : lastResponseOf(session),
        idleMinutes: config.idleMinutes,
        grantedAt: session === void 0 ? void 0 : unlocks.grantedAt(session.id),
        unlockTtlMinutes: config.unlockTtlMinutes,
        dryRun: config.dryRun
      });
    }
  };
}

// src/modes.ts
var MODES = ["block", "archive", "both", "off"];
function isMode(value) {
  return typeof value === "string" && MODES.includes(value);
}

// src/config.ts
var DEFAULTS = {
  mode: "block",
  idleMinutes: 60,
  archiveAfterMinutes: 1440,
  unlockTtlMinutes: 10,
  checkIntervalSeconds: 60,
  skipPinned: true,
  archiveExisting: false,
  maxPerCycle: 20,
  dryRun: false
};
var KNOWN_KEYS = /* @__PURE__ */ new Set([...Object.keys(DEFAULTS), "stateFile"]);
function readInteger(raw, key, min, m) {
  const value = raw[key];
  if (typeof value !== "number") {
    throw new Error(m.configNotNumber(key));
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(m.configNotInteger(key));
  }
  if (value < min) {
    throw new Error(m.configBelowMinimum(key, min));
  }
  return value;
}
function readBoolean(raw, key, m) {
  const value = raw[key];
  if (typeof value !== "boolean") {
    throw new Error(m.configNotBoolean(key));
  }
  return value;
}
function readString(raw, key, m) {
  const value = raw[key];
  if (typeof value !== "string") {
    throw new Error(m.configNotString(key));
  }
  return value;
}
function readMode(raw, m) {
  const value = raw.mode;
  if (!isMode(value)) {
    throw new Error(m.configInvalidMode(MODES.join(" / ")));
  }
  return value;
}
function parseConfig(raw, locale) {
  if (raw === void 0 || raw === null) {
    return { ...DEFAULTS };
  }
  const m = MESSAGES[locale];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(m.configNotObject);
  }
  const obj = raw;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(m.configUnknownKey(key));
    }
  }
  const config = { ...DEFAULTS };
  if (obj.mode !== void 0) {
    config.mode = readMode(obj, m);
  }
  if (obj.idleMinutes !== void 0) {
    config.idleMinutes = readInteger(obj, "idleMinutes", 1, m);
  }
  if (obj.archiveAfterMinutes !== void 0) {
    config.archiveAfterMinutes = readInteger(obj, "archiveAfterMinutes", 1, m);
  }
  if (obj.unlockTtlMinutes !== void 0) {
    config.unlockTtlMinutes = readInteger(obj, "unlockTtlMinutes", 1, m);
  }
  if (obj.checkIntervalSeconds !== void 0) {
    config.checkIntervalSeconds = readInteger(obj, "checkIntervalSeconds", 10, m);
  }
  if (obj.skipPinned !== void 0) {
    config.skipPinned = readBoolean(obj, "skipPinned", m);
  }
  if (obj.archiveExisting !== void 0) {
    config.archiveExisting = readBoolean(obj, "archiveExisting", m);
  }
  if (obj.maxPerCycle !== void 0) {
    config.maxPerCycle = readInteger(obj, "maxPerCycle", 1, m);
  }
  if (obj.dryRun !== void 0) {
    config.dryRun = readBoolean(obj, "dryRun", m);
  }
  if (obj.stateFile !== void 0) {
    config.stateFile = readString(obj, "stateFile", m);
  }
  return config;
}

// src/decide.ts
var MS_PER_MINUTE = 6e4;
function decideArchive(input) {
  const { sessions, now, baselineAt, unarchivedAt, idleMinutes, skipPinned, archiveExisting } = input;
  const threshold = idleMinutes * MS_PER_MINUTE;
  const candidates = [];
  for (const session of sessions) {
    if (session.origin === "subagent") continue;
    if (session.parentSession !== void 0) continue;
    if (session.archived) continue;
    if (skipPinned && session.pinned) continue;
    const lastActivity = session.lastActivityAt ?? session.createdAt;
    const unarchived = unarchivedAt[session.id] ?? 0;
    const effective = Math.max(lastActivity, unarchived);
    const idle = effective > now ? 0 : now - effective;
    if (!archiveExisting && effective < baselineAt) continue;
    if (!(idle > threshold)) continue;
    candidates.push({ id: session.id, idle });
  }
  return candidates.sort((a, b) => b.idle - a.idle).map((candidate) => candidate.id);
}

// src/diff-unarchive.ts
function detectUnarchived(prev, current) {
  if (prev === void 0) return [];
  const alive = new Set(current);
  const unarchived = [];
  for (const id of prev) {
    if (!alive.has(id)) unarchived.push(id);
  }
  return unarchived;
}
function recordUnarchived(unarchivedAt, ids, now) {
  const next = { ...unarchivedAt };
  for (const id of ids) {
    next[id] = now;
  }
  return next;
}
function pruneUnarchived(unarchivedAt, now, retentionMs, knownIds) {
  const entries = Object.entries(unarchivedAt).filter(([id, at]) => {
    if (now - at > retentionMs) {
      return false;
    }
    if (knownIds !== void 0 && !knownIds.has(id)) {
      return false;
    }
    return true;
  });
  return Object.fromEntries(entries);
}

// src/cycle.ts
var UNARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
function sameKeySet(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!(key in b)) return false;
  }
  return true;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function runCycle(deps, settings, memory) {
  const now = deps.now();
  const archivedNow = deps.archivedIds();
  const unarchivedIds = detectUnarchived(memory.prevArchived, archivedNow);
  let unarchivedAt = memory.unarchivedAt;
  if (unarchivedIds.length > 0) {
    unarchivedAt = recordUnarchived(memory.unarchivedAt, unarchivedIds, now);
    deps.log.info(`\u624B\u52D5\u89E3\u9664\u3092\u691C\u51FA\u3057\u307E\u3057\u305F: ${unarchivedIds.join(", ")}`);
  }
  const recordedUnarchived = unarchivedIds.length > 0;
  const sessions = await deps.listSessions();
  const targets = decideArchive({
    sessions,
    now,
    baselineAt: memory.baselineAt,
    unarchivedAt,
    idleMinutes: settings.thresholdMinutes,
    skipPinned: settings.skipPinned,
    archiveExisting: settings.archiveExisting
  });
  const limited = targets.slice(0, settings.maxPerCycle);
  const archived = [];
  const skippedActive = [];
  const failed = [];
  const dryRunTargets = [];
  if (settings.dryRun) {
    for (const id of limited) {
      dryRunTargets.push(id);
      deps.log.info(`dryRun: \u30A2\u30FC\u30AB\u30A4\u30D6\u5BFE\u8C61 ${id}`);
    }
  } else {
    for (const id of limited) {
      try {
        await deps.archive(id);
        archived.push(id);
      } catch (error) {
        if (deps.isActiveError(error)) {
          skippedActive.push(id);
          deps.log.debug(`\u5B9F\u884C\u4E2D\u306E\u305F\u3081\u898B\u9001\u308A\u307E\u3059 (\u6B21\u56DE\u518D\u8A66\u884C): ${id}`);
        } else {
          failed.push(id);
          deps.log.warn(`\u30A2\u30FC\u30AB\u30A4\u30D6\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${id}: ${errorMessage(error)}`);
        }
      }
    }
  }
  const prevArchived = new Set(archivedNow);
  for (const id of archived) {
    prevArchived.add(id);
  }
  const knownIds = new Set(sessions.map((session) => session.id));
  const pruned = pruneUnarchived(unarchivedAt, now, UNARCHIVE_RETENTION_MS, knownIds);
  const unarchivedChanged = recordedUnarchived || !sameKeySet(unarchivedAt, pruned);
  return {
    unarchivedAt: pruned,
    prevArchived,
    archived,
    skippedActive,
    failed,
    dryRunTargets,
    unarchivedChanged
  };
}

// src/i18n.ts
var SKIPPED = /* @__PURE__ */ new Set(["", "c", "posix"]);
function normalize(candidate) {
  const withoutModifier = candidate.split("@")[0] ?? "";
  const withoutEncoding = withoutModifier.split(".")[0] ?? "";
  return withoutEncoding.replace(/_/g, "-").trim().toLowerCase();
}
function resolveLocale(candidates) {
  for (const candidate of candidates) {
    if (candidate === void 0) continue;
    const normalized = normalize(candidate);
    if (SKIPPED.has(normalized)) continue;
    if (normalized.startsWith("ja")) return "ja";
    if (normalized.startsWith("zh")) return "zh-CN";
    return "en";
  }
  return "en";
}

// src/log.ts
var LOG_PREFIX = "[cache-sentinel]";
function createLogger(base, sink) {
  return {
    debug(message) {
      base.debug(message);
    },
    info(message) {
      base.info(message);
      sink.log(`${LOG_PREFIX} ${message}`);
    },
    warn(message) {
      base.warn(message);
      sink.warn(`${LOG_PREFIX} ${message}`);
    }
  };
}

// src/mode.ts
function effectiveMode(stateMode, configMode) {
  if (stateMode !== void 0) {
    return { mode: stateMode, source: "command" };
  }
  return { mode: configMode, source: "config" };
}
function blocks(mode) {
  return mode === "block" || mode === "both";
}
function archives(mode) {
  return mode === "archive" || mode === "both";
}
function archiveThresholdMinutes(mode, cfg) {
  switch (mode) {
    case "archive":
      return cfg.idleMinutes;
    case "both":
      return cfg.archiveAfterMinutes;
    default:
      return void 0;
  }
}
function parseSentinelArgs(rawInput) {
  const trimmed = rawInput.trim();
  const normalized = trimmed.toLowerCase();
  if (normalized === "") {
    return { kind: "status" };
  }
  if (normalized === "default") {
    return { kind: "default" };
  }
  if (isMode(normalized)) {
    return { kind: "set", mode: normalized };
  }
  return { kind: "invalid", input: trimmed };
}
function modeLine(s, m) {
  return s.source === "command" ? m.modeLineFromCommand(s.mode, s.configMode) : m.modeLineFromConfig(s.mode);
}
function modeDescription(s, m) {
  switch (s.mode) {
    case "block":
      return m.modeBlock(s.idleMinutes, s.unlockTtlMinutes);
    case "archive":
      return m.modeArchive(s.idleMinutes);
    case "both":
      return m.modeBoth(s.idleMinutes, s.archiveAfterMinutes);
    case "off":
      return m.modeOff;
  }
}
function sessionLine(s, m) {
  if (s.sessionIdleMinutes === void 0) {
    return m.modeSessionNoResponse;
  }
  return m.modeSession(s.sessionIdleMinutes);
}
function statusMessage(s, locale) {
  const m = MESSAGES[locale];
  const lines = [modeLine(s, m), modeDescription(s, m), sessionLine(s, m)];
  if (s.dryRun) {
    lines.push(m.modeDryRun);
  }
  return lines.join("\n");
}
function usageMessage(locale) {
  return MESSAGES[locale].sentinelUsage;
}
function unlockInactiveMessage(mode, locale) {
  return MESSAGES[locale].unlockInactive(mode);
}

// src/state.ts
import { mkdir, readFile, rename, stat as stat2, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
var STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
function emptyState() {
  return { version: 2, unarchivedAt: {} };
}
function isNonNegativeFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function parseUnarchivedAt(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = [];
  for (const [id, at] of Object.entries(value)) {
    if (isNonNegativeFinite(at)) {
      entries.push([id, at]);
    }
  }
  return Object.fromEntries(entries);
}
function parseState(text) {
  if (text === void 0) {
    return emptyState();
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyState();
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyState();
  }
  const record = raw;
  const version = record.version;
  if (version !== 1 && version !== 2) {
    return emptyState();
  }
  const state = emptyState();
  const baselineAt = record.baselineAt;
  const mode = record.mode;
  if (version === 1) {
    if (!isNonNegativeFinite(baselineAt)) {
      return emptyState();
    }
    state.baselineAt = baselineAt;
  } else {
    if (isNonNegativeFinite(baselineAt)) {
      state.baselineAt = baselineAt;
    }
    if (isMode(mode)) {
      state.mode = mode;
    }
  }
  state.unarchivedAt = parseUnarchivedAt(record.unarchivedAt);
  return state;
}
async function loadState(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return emptyState();
  }
  return parseState(text);
}
async function stateExists(filePath) {
  try {
    await stat2(filePath);
    return true;
  } catch (error) {
    return error.code !== "ENOENT";
  }
}
function tempPathFor(target, unique, p = path) {
  return `${p.join(p.dirname(target), p.basename(target))}.${unique}.tmp`;
}
async function saveState(filePath, state) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const json = `${JSON.stringify(state, null, 2)}
`;
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmp = tempPathFor(filePath, unique);
  await writeFile(tmp, json, "utf8");
  try {
    await rename(tmp, filePath);
  } catch (error) {
    await unlink(tmp).catch(() => {
    });
    throw error;
  }
}

// src/index.ts
var name = "cache-sentinel";
var inject = ["commands", "workspaceRegistry", "sessionPersistence", "sessions", "timer", "connection"];
var STATUS_PATH = "/api/cache-sentinel.status";
function profileNameOf(ctx) {
  const profile = ctx.get?.("profileContext");
  const name2 = profile?.name;
  if (typeof name2 !== "string") return void 0;
  const invalid = name2 === "" || name2.includes("/") || name2.includes("\\") || name2 === "." || name2 === ".." || name2 === "node_modules";
  return invalid ? void 0 : name2;
}
function statePathFor(home, profileName, configured, p = path2) {
  if (configured !== void 0) return { file: configured };
  const legacy = p.join(home, "cache-sentinel", "state.json");
  if (profileName === void 0) return { file: legacy };
  return { file: p.join(home, "cache-sentinel", "profiles", profileName, "state.json"), legacy };
}
async function loadInitialState(location, log) {
  const { file, legacy } = location;
  if (legacy === void 0 || await stateExists(file)) return loadState(file);
  const state = await loadState(legacy);
  try {
    await saveState(file, state);
    log.info(`\u72B6\u614B\u30D5\u30A1\u30A4\u30EB\u3092\u4F5C\u308A\u307E\u3057\u305F: ${file}(\u5F93\u6765\u306E ${legacy} \u304B\u3089\u5F15\u304D\u7D99\u304E\u3002\u7121\u3051\u308C\u3070\u7A7A\u306E\u72B6\u614B)`);
  } catch (error) {
    log.warn(`state.json \u306E\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${String(error)}`);
  }
  return state;
}
function createRuntime(config, initialState, cycleDeps, log, io, locale) {
  let state = initialState;
  let prevArchived;
  let running = false;
  let writes = Promise.resolve();
  const current = () => effectiveMode(state.mode, config.mode);
  const persist = () => {
    const snapshot = state;
    writes = writes.then(() => io.save(snapshot)).catch((error) => log.warn(`state.json \u306E\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${String(error)}`));
    return writes;
  };
  const ensureBaseline = (mode) => {
    if (!archives(mode) || state.baselineAt !== void 0) return false;
    state = { ...state, baselineAt: io.now() };
    return true;
  };
  const block = createSentinel(config, log, locale, io.now, () => blocks(current().mode));
  const runtime = {
    mode: () => current().mode,
    onPreStep: (payload, next) => block.onPreStep(payload, next),
    onSessionEvent: (session, event) => block.onSessionEvent(session, event),
    unlock: (agent) => block.unlock(agent, unlockInactiveMessage(current().mode, locale)),
    status: (session) => block.statusOf(session, current().mode),
    async sentinel(agent, rawInput) {
      const command = parseSentinelArgs(rawInput);
      if (command.kind === "invalid") return { kind: "error", text: usageMessage(locale) };
      if (command.kind === "set" || command.kind === "default") {
        const before = current().mode;
        if (command.kind === "set") {
          state = { ...state, mode: command.mode };
        } else {
          const { mode: _dropped, ...rest } = state;
          state = rest;
        }
        const after = current().mode;
        ensureBaseline(after);
        await persist();
        log.info(`\u30E2\u30FC\u30C9\u3092\u5909\u66F4\u3057\u307E\u3057\u305F: ${before} \u2192 ${after}(${command.kind === "set" ? "/sentinel" : "YAML \u306B\u623B\u3059"})`);
        if (archives(after) && !archives(before)) {
          prevArchived = void 0;
          void runtime.tick();
        }
      }
      const { mode, source } = current();
      return {
        kind: "success",
        text: statusMessage({
          mode,
          source,
          configMode: config.mode,
          idleMinutes: config.idleMinutes,
          archiveAfterMinutes: config.archiveAfterMinutes,
          unlockTtlMinutes: config.unlockTtlMinutes,
          dryRun: config.dryRun,
          sessionIdleMinutes: block.idleMinutesOf(agent.session)
        }, locale)
      };
    },
    async tick() {
      if (running) return;
      running = true;
      try {
        const mode = current().mode;
        const threshold = archiveThresholdMinutes(mode, config);
        if (threshold === void 0) {
          prevArchived = void 0;
          return;
        }
        if (ensureBaseline(mode)) await persist();
        const result = await runCycle(
          cycleDeps,
          {
            thresholdMinutes: threshold,
            skipPinned: config.skipPinned,
            archiveExisting: config.archiveExisting,
            maxPerCycle: config.maxPerCycle,
            dryRun: config.dryRun
          },
          { baselineAt: state.baselineAt ?? io.now(), unarchivedAt: state.unarchivedAt, prevArchived }
        );
        prevArchived = result.prevArchived;
        state = { ...state, unarchivedAt: result.unarchivedAt };
        if (result.unarchivedChanged) await persist();
        if (result.archived.length > 0) log.info(`${result.archived.length} \u4EF6\u3092\u30A2\u30FC\u30AB\u30A4\u30D6\u3057\u307E\u3057\u305F`);
      } catch (error) {
        log.warn(`\u30A2\u30FC\u30AB\u30A4\u30D6\u306E\u30B5\u30A4\u30AF\u30EB\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${String(error)}`);
      } finally {
        running = false;
      }
    }
  };
  return runtime;
}
function statusResponse(request, lookup) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (sessionId === null || sessionId === "") {
    return new Response("missing sessionId query parameter", { status: 400 });
  }
  return new Response(JSON.stringify(lookup(sessionId)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function apply(ctx, rawConfig) {
  const locale = resolveLocale([
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale
  ]);
  const config = parseConfig(rawConfig, locale);
  const log = createLogger(ctx.logger, console);
  const home = resolveHome();
  const profile = profileNameOf(ctx);
  const location = statePathFor(home, profile, config.stateFile);
  const initialState = await loadInitialState(location, log);
  const sessionsRoot = join3(home, "sessions");
  const runtime = createRuntime(
    config,
    initialState,
    createDeps(ctx, () => scanLogMtimes(sessionsRoot), log),
    log,
    { now: Date.now, save: (state) => saveState(location.file, state) },
    locale
  );
  ctx.on("agent/pre-step", (payload, next) => runtime.onPreStep(payload, next), { prepend: true });
  ctx.on("session/event", (session, event) => runtime.onSessionEvent(session, event));
  ctx.commands.register({
    name: "unlock",
    description: MESSAGES[locale].commandUnlockDescription,
    handler: ({ agent }) => runtime.unlock(agent)
  });
  ctx.commands.register({
    name: "sentinel",
    description: MESSAGES[locale].commandSentinelDescription,
    // 入力欄から `/sentinel archive` のように引数つきで実行できるようにする(#36、根拠は docs/spike.md Y1/Y2)。
    // 引数は任意で、解釈は runtime.sentinel の parseSentinelArgs が行う。
    input: { hint: MESSAGES[locale].commandSentinelInputHint },
    handler: ({ agent, rawInput }) => runtime.sentinel(agent, rawInput)
  });
  ctx.interval(() => void runtime.tick(), config.checkIntervalSeconds * 1e3);
  ctx.connection.fetch.register({
    path: STATUS_PATH,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request) => statusResponse(request, (id) => runtime.status(ctx.sessions.get(id)))
  });
  log.info(
    `\u958B\u59CB (\u30E2\u30FC\u30C9 ${runtime.mode()}, \u5165\u529B\u7981\u6B62 ${config.idleMinutes} \u5206, both \u306E\u30A2\u30FC\u30AB\u30A4\u30D6 ${config.archiveAfterMinutes} \u5206${config.dryRun ? ", dryRun" : ""})`
  );
  log.info(`\u72B6\u614B\u30D5\u30A1\u30A4\u30EB: ${location.file}${profile === void 0 ? " (\u30D7\u30ED\u30D5\u30A1\u30A4\u30EB\u540D\u306A\u3057)" : ""}`);
  void runtime.tick();
}
export {
  STATUS_PATH,
  apply,
  createRuntime,
  inject,
  loadInitialState,
  name,
  profileNameOf,
  statePathFor,
  statusResponse
};
