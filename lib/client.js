window.__ModuleLoader__.load({
	id: "cache-sentinel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  POLL_MS: () => POLL_MS,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react2 = require("react");

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

// src/messages.ts
var en = {
  noticeBlocked: (idleMinutes) => `Send blocked (${idleMinutes} minutes since the last response, as the cache has likely expired).`,
  noticeUnlockHint: "You can allow the next single send with /unlock.",
  noticeDiscarded: "Discarded input:",
  noticeInputSource: (kind) => `(input from ${kind})`,
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
  commandSentinelInputHint: "[block|archive|both|off|default]",
  settingsLabels: {
    mode: "Mode",
    idleMinutes: "Minutes until sends are blocked",
    archiveAfterMinutes: "Minutes until archiving (both mode)",
    unlockTtlMinutes: "Minutes /unlock stays valid",
    checkIntervalSeconds: "Archive check interval (seconds)",
    skipPinned: "Do not archive pinned sessions",
    archiveExisting: "Also archive sessions that were already idle",
    maxPerCycle: "Sessions archived per check (max)",
    dryRun: "Dry run (log only)"
  },
  settingsHints: {
    mode: "block: block sends; archive: archive sessions; both: block, then archive later; off: do nothing. A mode chosen with /sentinel takes precedence (/sentinel default returns to this one).",
    idleMinutes: "Minutes since the last response. Also the archive threshold in archive mode. Integer, 1 or more.",
    archiveAfterMinutes: "Archive threshold in both mode. Integer, 1 or more.",
    unlockTtlMinutes: "How long an /unlock allowance lasts. Integer, 1 or more.",
    checkIntervalSeconds: "How often to look for sessions to archive. Integer, 10 or more.",
    skipPinned: "Pinned sessions are never archived.",
    archiveExisting: "Include sessions that stopped before archiving was first enabled.",
    maxPerCycle: "Upper limit per check. Integer, 1 or more.",
    dryRun: "Neither block nor archive; only write what would happen to the log."
  },
  settingsModeOptions: { block: "block", archive: "archive", both: "both", off: "off" },
  settingsInvalidInteger: (min) => `Enter an integer of ${min} or more, or leave blank to use the default.`,
  settingsOverridden: "Changed",
  settingsReset: "Reset to default",
  settingsReadOnly: "This deployment stores settings read-only.",
  settingsUnavailable: "cache-sentinel is not running, so it cannot be configured right now.",
  settingsSave: "Save",
  settingsSaving: "Saving\u2026",
  settingsSaveFailed: "These values were not accepted; they are kept here for you to correct.",
  settingsStateFileNote: "The state file location (stateFile) is set in the profile patch, not here."
};
var ja = {
  noticeBlocked: (idleMinutes) => `\u9001\u4FE1\u3092\u6B62\u3081\u307E\u3057\u305F(\u6700\u7D42\u5FDC\u7B54\u304B\u3089 ${idleMinutes} \u5206\u3002\u30AD\u30E3\u30C3\u30B7\u30E5\u304C\u5207\u308C\u3066\u3044\u308B\u53EF\u80FD\u6027\u304C\u9AD8\u3044\u305F\u3081)\u3002`,
  noticeUnlockHint: "/unlock \u3067\u6B21\u306E 1 \u56DE\u3092\u8A31\u53EF\u3067\u304D\u307E\u3059\u3002",
  noticeDiscarded: "\u7834\u68C4\u3055\u308C\u305F\u5165\u529B:",
  noticeInputSource: (kind) => `(${kind} \u304B\u3089\u306E\u5165\u529B)`,
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
  commandSentinelInputHint: "[block|archive|both|off|default]",
  settingsLabels: {
    mode: "\u30E2\u30FC\u30C9",
    idleMinutes: "\u5165\u529B\u7981\u6B62\u307E\u3067\u306E\u5206\u6570",
    archiveAfterMinutes: "\u30A2\u30FC\u30AB\u30A4\u30D6\u307E\u3067\u306E\u5206\u6570(both \u30E2\u30FC\u30C9)",
    unlockTtlMinutes: "/unlock \u306E\u6709\u52B9\u6642\u9593(\u5206)",
    checkIntervalSeconds: "\u30A2\u30FC\u30AB\u30A4\u30D6\u306E\u78BA\u8A8D\u9593\u9694(\u79D2)",
    skipPinned: "\u30D4\u30F3\u7559\u3081\u3057\u305F\u30BB\u30C3\u30B7\u30E7\u30F3\u306F\u30A2\u30FC\u30AB\u30A4\u30D6\u3057\u306A\u3044",
    archiveExisting: "\u524D\u304B\u3089\u6B62\u307E\u3063\u3066\u3044\u305F\u30BB\u30C3\u30B7\u30E7\u30F3\u3082\u30A2\u30FC\u30AB\u30A4\u30D6\u3059\u308B",
    maxPerCycle: "1 \u56DE\u306B\u30A2\u30FC\u30AB\u30A4\u30D6\u3059\u308B\u4E0A\u9650",
    dryRun: "\u30ED\u30B0\u3060\u3051\u51FA\u3059(dryRun)"
  },
  settingsHints: {
    mode: "block: \u9001\u4FE1\u3092\u6B62\u3081\u308B / archive: \u30A2\u30FC\u30AB\u30A4\u30D6\u3059\u308B / both: \u9001\u4FE1\u3092\u6B62\u3081\u3001\u3055\u3089\u306B\u5F8C\u3067\u30A2\u30FC\u30AB\u30A4\u30D6 / off: \u4F55\u3082\u3057\u306A\u3044\u3002/sentinel \u3067\u9078\u3093\u3060\u30E2\u30FC\u30C9\u304C\u3042\u308C\u3070\u305D\u3061\u3089\u304C\u512A\u5148\u3055\u308C\u307E\u3059(/sentinel default \u3067\u3053\u3053\u306E\u5024\u306B\u623B\u308A\u307E\u3059)\u3002",
    idleMinutes: "\u6700\u7D42\u5FDC\u7B54\u304B\u3089\u306E\u5206\u6570\u3002archive \u30E2\u30FC\u30C9\u3067\u306F\u30A2\u30FC\u30AB\u30A4\u30D6\u306E\u3057\u304D\u3044\u5024\u306B\u3082\u306A\u308A\u307E\u3059\u30021 \u4EE5\u4E0A\u306E\u6574\u6570\u3002",
    archiveAfterMinutes: "both \u30E2\u30FC\u30C9\u306E\u30A2\u30FC\u30AB\u30A4\u30D6\u306E\u3057\u304D\u3044\u5024\u30021 \u4EE5\u4E0A\u306E\u6574\u6570\u3002",
    unlockTtlMinutes: "/unlock \u3067\u8A31\u53EF\u3057\u305F\u9001\u4FE1\u306E\u6709\u52B9\u6642\u9593\u30021 \u4EE5\u4E0A\u306E\u6574\u6570\u3002",
    checkIntervalSeconds: "\u30A2\u30FC\u30AB\u30A4\u30D6\u3059\u308B\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u63A2\u3059\u9593\u9694\u300210 \u4EE5\u4E0A\u306E\u6574\u6570\u3002",
    skipPinned: "\u30D4\u30F3\u7559\u3081\u3057\u305F\u30BB\u30C3\u30B7\u30E7\u30F3\u306F\u30A2\u30FC\u30AB\u30A4\u30D6\u3057\u307E\u305B\u3093\u3002",
    archiveExisting: "\u30A2\u30FC\u30AB\u30A4\u30D6\u3092\u521D\u3081\u3066\u6709\u52B9\u306B\u3059\u308B\u524D\u306B\u6B62\u307E\u3063\u3066\u3044\u305F\u30BB\u30C3\u30B7\u30E7\u30F3\u3082\u5BFE\u8C61\u306B\u3057\u307E\u3059\u3002",
    maxPerCycle: "1 \u56DE\u306E\u78BA\u8A8D\u3067\u30A2\u30FC\u30AB\u30A4\u30D6\u3059\u308B\u4EF6\u6570\u306E\u4E0A\u9650\u30021 \u4EE5\u4E0A\u306E\u6574\u6570\u3002",
    dryRun: "\u9001\u4FE1\u3092\u6B62\u3081\u305A\u3001\u30A2\u30FC\u30AB\u30A4\u30D6\u3082\u305B\u305A\u3001\u305D\u3046\u3059\u308B\u4E88\u5B9A\u3060\u3063\u305F\u3053\u3068\u3092\u30ED\u30B0\u306B\u51FA\u3059\u3060\u3051\u306B\u3057\u307E\u3059\u3002"
  },
  settingsModeOptions: { block: "block", archive: "archive", both: "both", off: "off" },
  settingsInvalidInteger: (min) => `${min} \u4EE5\u4E0A\u306E\u6574\u6570\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u7A7A\u6B04\u306B\u3059\u308B\u3068\u65E2\u5B9A\u5024\u306B\u623B\u308A\u307E\u3059\u3002`,
  settingsOverridden: "\u5909\u66F4\u3042\u308A",
  settingsReset: "\u65E2\u5B9A\u5024\u306B\u623B\u3059",
  settingsReadOnly: "\u3053\u306E\u74B0\u5883\u3067\u306F\u8A2D\u5B9A\u306F\u8AAD\u307F\u53D6\u308A\u5C02\u7528\u3067\u3059\u3002",
  settingsUnavailable: "cache-sentinel \u304C\u52D5\u3044\u3066\u3044\u306A\u3044\u305F\u3081\u3001\u3044\u307E\u306F\u8A2D\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002",
  settingsSave: "\u4FDD\u5B58",
  settingsSaving: "\u4FDD\u5B58\u4E2D\u2026",
  settingsSaveFailed: "\u3053\u306E\u5024\u306F\u53D7\u3051\u4ED8\u3051\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u76F4\u305B\u308B\u3088\u3046\u5165\u529B\u306F\u305D\u306E\u307E\u307E\u6B8B\u3057\u3066\u3044\u307E\u3059\u3002",
  settingsStateFileNote: "\u72B6\u614B\u30D5\u30A1\u30A4\u30EB\u306E\u5834\u6240(stateFile)\u306F\u3001\u3053\u3053\u3067\u306F\u306A\u304F\u30D7\u30ED\u30D5\u30A1\u30A4\u30EB\u306E patch \u3067\u8A2D\u5B9A\u3057\u307E\u3059\u3002"
};
var zhCN = {
  noticeBlocked: (idleMinutes) => `\u5DF2\u963B\u6B62\u53D1\u9001(\u8DDD\u6700\u540E\u4E00\u6B21\u54CD\u5E94 ${idleMinutes} \u5206\u949F\uFF0C\u56E0\u4E3A\u7F13\u5B58\u5F88\u53EF\u80FD\u5DF2\u8FC7\u671F)\u3002`,
  noticeUnlockHint: "\u53EF\u7528 /unlock \u5141\u8BB8\u4E0B 1 \u6B21\u53D1\u9001\u3002",
  noticeDiscarded: "\u5DF2\u4E22\u5F03\u7684\u8F93\u5165\uFF1A",
  noticeInputSource: (kind) => `(\u6765\u81EA ${kind} \u7684\u8F93\u5165)`,
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
  commandSentinelInputHint: "[block|archive|both|off|default]",
  settingsLabels: {
    mode: "\u6A21\u5F0F",
    idleMinutes: "\u7981\u6B62\u53D1\u9001\u524D\u7684\u5206\u949F\u6570",
    archiveAfterMinutes: "\u5F52\u6863\u524D\u7684\u5206\u949F\u6570(both \u6A21\u5F0F)",
    unlockTtlMinutes: "/unlock \u7684\u6709\u6548\u5206\u949F\u6570",
    checkIntervalSeconds: "\u5F52\u6863\u68C0\u67E5\u95F4\u9694(\u79D2)",
    skipPinned: "\u4E0D\u5F52\u6863\u5DF2\u7F6E\u9876\u7684\u4F1A\u8BDD",
    archiveExisting: "\u4E5F\u5F52\u6863\u6B64\u524D\u5DF2\u505C\u6B62\u7684\u4F1A\u8BDD",
    maxPerCycle: "\u6BCF\u6B21\u68C0\u67E5\u6700\u591A\u5F52\u6863\u7684\u4F1A\u8BDD\u6570",
    dryRun: "\u4EC5\u8BB0\u5F55\u65E5\u5FD7(dryRun)"
  },
  settingsHints: {
    mode: "block\uFF1A\u7981\u6B62\u53D1\u9001\uFF1Barchive\uFF1A\u5F52\u6863\u4F1A\u8BDD\uFF1Bboth\uFF1A\u7981\u6B62\u53D1\u9001\uFF0C\u4E4B\u540E\u518D\u5F52\u6863\uFF1Boff\uFF1A\u4E0D\u6267\u884C\u4EFB\u4F55\u64CD\u4F5C\u3002\u82E5\u7528 /sentinel \u9009\u62E9\u4E86\u6A21\u5F0F\uFF0C\u5219\u4EE5\u5176\u4E3A\u51C6(/sentinel default \u53EF\u6062\u590D\u4E3A\u6B64\u5904\u7684\u503C)\u3002",
    idleMinutes: "\u8DDD\u4E0A\u6B21\u54CD\u5E94\u7684\u5206\u949F\u6570\u3002\u5728 archive \u6A21\u5F0F\u4E0B\u4E5F\u662F\u5F52\u6863\u9608\u503C\u3002\u4E0D\u5C0F\u4E8E 1 \u7684\u6574\u6570\u3002",
    archiveAfterMinutes: "both \u6A21\u5F0F\u7684\u5F52\u6863\u9608\u503C\u3002\u4E0D\u5C0F\u4E8E 1 \u7684\u6574\u6570\u3002",
    unlockTtlMinutes: "/unlock \u8BB8\u53EF\u7684\u6709\u6548\u65F6\u95F4\u3002\u4E0D\u5C0F\u4E8E 1 \u7684\u6574\u6570\u3002",
    checkIntervalSeconds: "\u67E5\u627E\u5F85\u5F52\u6863\u4F1A\u8BDD\u7684\u95F4\u9694\u3002\u4E0D\u5C0F\u4E8E 10 \u7684\u6574\u6570\u3002",
    skipPinned: "\u5DF2\u7F6E\u9876\u7684\u4F1A\u8BDD\u4E0D\u4F1A\u88AB\u5F52\u6863\u3002",
    archiveExisting: "\u5305\u62EC\u9996\u6B21\u542F\u7528\u5F52\u6863\u4E4B\u524D\u5C31\u5DF2\u505C\u6B62\u7684\u4F1A\u8BDD\u3002",
    maxPerCycle: "\u6BCF\u6B21\u68C0\u67E5\u5F52\u6863\u7684\u6570\u91CF\u4E0A\u9650\u3002\u4E0D\u5C0F\u4E8E 1 \u7684\u6574\u6570\u3002",
    dryRun: "\u65E2\u4E0D\u7981\u6B62\u53D1\u9001\u4E5F\u4E0D\u5F52\u6863\uFF0C\u53EA\u628A\u5C06\u8981\u6267\u884C\u7684\u64CD\u4F5C\u5199\u5165\u65E5\u5FD7\u3002"
  },
  settingsModeOptions: { block: "block", archive: "archive", both: "both", off: "off" },
  settingsInvalidInteger: (min) => `\u8BF7\u8F93\u5165\u4E0D\u5C0F\u4E8E ${min} \u7684\u6574\u6570\uFF1B\u7559\u7A7A\u5219\u4F7F\u7528\u9ED8\u8BA4\u503C\u3002`,
  settingsOverridden: "\u5DF2\u4FEE\u6539",
  settingsReset: "\u6062\u590D\u9ED8\u8BA4",
  settingsReadOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  settingsUnavailable: "cache-sentinel \u672A\u8FD0\u884C\uFF0C\u6682\u65F6\u65E0\u6CD5\u8BBE\u7F6E\u3002",
  settingsSave: "\u4FDD\u5B58",
  settingsSaving: "\u4FDD\u5B58\u4E2D\u2026",
  settingsSaveFailed: "\u8FD9\u4E9B\u503C\u672A\u88AB\u63A5\u53D7\uFF0C\u5DF2\u4FDD\u7559\u4F9B\u4F60\u4FEE\u6539\u3002",
  settingsStateFileNote: "\u72B6\u6001\u6587\u4EF6\u7684\u4F4D\u7F6E(stateFile)\u5728\u914D\u7F6E\u6587\u4EF6\u7684 patch \u4E2D\u8BBE\u7F6E\uFF0C\u4E0D\u5728\u6B64\u5904\u3002"
};
var MESSAGES = {
  en,
  ja,
  "zh-CN": zhCN
};

// src/client/banner.ts
function unlockLabel(locale) {
  return MESSAGES[locale].unlockLabel;
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isFiniteNumberOrNull(value) {
  return value === null || isFiniteNumber(value);
}
function parseStatus(value) {
  if (typeof value !== "object" || value === null) {
    return void 0;
  }
  const record = value;
  if (typeof record["gate"] !== "boolean" || typeof record["state"] !== "string" || !isFiniteNumberOrNull(record["idleMinutes"]) || !isFiniteNumberOrNull(record["unlockExpiresAt"]) || typeof record["dryRun"] !== "boolean") {
    return void 0;
  }
  return {
    gate: record["gate"],
    state: record["state"],
    idleMinutes: record["idleMinutes"],
    unlockExpiresAt: record["unlockExpiresAt"],
    dryRun: record["dryRun"]
  };
}
function bannerFor(status, now, locale) {
  if (status === void 0 || !status.gate) {
    return void 0;
  }
  const m = MESSAGES[locale];
  if (status.state === "stale" && !status.dryRun) {
    if (status.idleMinutes === null) {
      return {
        tone: "warning",
        text: m.bannerStaleNoIdle,
        action: "unlock"
      };
    }
    return {
      tone: "warning",
      text: m.bannerStale(status.idleMinutes),
      action: "unlock"
    };
  }
  if (status.state === "unlocked") {
    if (status.unlockExpiresAt === null) {
      return {
        tone: "info",
        text: m.bannerUnlocked
      };
    }
    const remainingMinutes = Math.max(0, Math.ceil((status.unlockExpiresAt - now) / 6e4));
    return {
      tone: "info",
      text: m.bannerUnlockedRemaining(remainingMinutes)
    };
  }
  return void 0;
}
function statusUrl(base, sessionId) {
  const url = new URL("api/cache-sentinel.status", base);
  url.searchParams.set("sessionId", sessionId);
  return url.href;
}

// src/client/fetch-status.ts
async function fetchStatus(sessionId, base, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(statusUrl(base, sessionId), { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return void 0;
    return parseStatus(await response.json());
  } catch {
    return void 0;
  }
}

// src/client/run-unlock.ts
function unlockFailure(result, locale) {
  const m = MESSAGES[locale];
  if (typeof result !== "object" || result === null) return m.bannerUnlockFailed("unexpected response");
  const record = result;
  if (record["ok"] === true) return record["value"] === void 0 ? m.bannerUnlockNotFound : void 0;
  if (record["ok"] === false) return m.bannerUnlockFailed(describeError(record["error"]));
  return m.bannerUnlockFailed("unexpected response");
}
async function runUnlock(execute, locale) {
  let result;
  try {
    result = await execute();
  } catch (error) {
    return MESSAGES[locale].bannerUnlockFailed(describeError(error));
  }
  return unlockFailure(result, locale);
}
function describeError(error) {
  if (typeof error !== "object" || error === null) return String(error);
  const { code, message } = error;
  if (typeof code === "string" && typeof message === "string" && message !== "") return `${code}: ${message}`;
  if (typeof code === "string") return code;
  if (typeof message === "string" && message !== "") return message;
  return "unknown error";
}

// src/client/settings-page.ts
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");

// src/modes.ts
var MODES = ["block", "archive", "both", "off"];
function isMode(value) {
  return typeof value === "string" && MODES.includes(value);
}
function asMode(text, fallback) {
  return isMode(text) ? text : fallback;
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
var CONFIG_KEYS = [
  { key: "mode", kind: "mode", live: true },
  { key: "idleMinutes", kind: "integer", min: 1, live: true },
  { key: "archiveAfterMinutes", kind: "integer", min: 1, live: true },
  { key: "unlockTtlMinutes", kind: "integer", min: 1, live: true },
  { key: "checkIntervalSeconds", kind: "integer", min: 10, live: true },
  { key: "skipPinned", kind: "boolean", live: true },
  { key: "archiveExisting", kind: "boolean", live: true },
  { key: "maxPerCycle", kind: "integer", min: 1, live: true },
  { key: "dryRun", kind: "boolean", live: true },
  { key: "stateFile", kind: "string", live: false }
];
var KNOWN_KEYS = new Set(CONFIG_KEYS.map((spec) => spec.key));

// src/client/settings-fields.ts
var SETTINGS_FIELDS = CONFIG_KEYS.flatMap((spec) => {
  switch (spec.kind) {
    case "mode":
      return [{ key: "mode", kind: "mode" }];
    case "integer":
      return [{ key: spec.key, kind: "integer", min: spec.min }];
    case "boolean":
      return [{ key: spec.key, kind: "boolean" }];
    case "string":
      return [];
  }
});
function integerField(field, min) {
  return {
    field,
    format: (value) => typeof value === "number" ? String(value) : "",
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      if (!/^[+-]?\d+$/.test(trimmed)) return void 0;
      const value = Number(trimmed);
      return Number.isSafeInteger(value) && value >= min ? { kind: "set", value } : void 0;
    }
  };
}
function booleanField(field) {
  return {
    field,
    format: (value) => value === true ? "true" : value === false ? "false" : "",
    parse: (text) => {
      if (text === "true") return { kind: "set", value: true };
      if (text === "false") return { kind: "set", value: false };
      return text === "" ? { kind: "clear" } : void 0;
    }
  };
}
function modeField(field) {
  return {
    field,
    format: (value) => isMode(value) ? value : "",
    parse: (text) => text === "" ? { kind: "clear" } : isMode(text) ? { kind: "set", value: text } : void 0
  };
}
function fieldSpecs() {
  return SETTINGS_FIELDS.map((field) => {
    switch (field.kind) {
      case "mode":
        return modeField(field.key);
      case "integer":
        return integerField(field.key, field.min);
      case "boolean":
        return booleanField(field.key);
      default: {
        const unexpected = field;
        throw new Error(`unknown settings field: ${JSON.stringify(unexpected)}`);
      }
    }
  });
}

// src/client/settings-page.ts
var ENTRY_ID = "cache-sentinel";
var PACKAGE_NAME = "cache-sentinel";
var SettingsPageController = class {
  form;
  store;
  locale;
  constructor(scope, locale) {
    this.locale = locale;
    this.form = new import_dsh_client_ui_primitives.SettingsFormModel(scope, fieldSpecs());
    this.store = this.form.bind(() => this.projection());
  }
  projection() {
    const fields = Object.fromEntries(SETTINGS_FIELDS.map((field) => [field.key, this.form.field(field.key)]));
    return { ...this.form.shell(), ...fields };
  }
  face() {
    return { hooks: { settingsPage: this.store }, locale: this.locale, ...this.form.actions() };
  }
  dispose() {
    this.form.dispose();
  }
};
var CSS = `
.cache-sentinel-settings-rows {
  display: flex;
  flex-direction: column;
}
.cache-sentinel-settings-rows > * + * {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.cache-sentinel-settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.cache-sentinel-settings-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cache-sentinel-settings-label {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}
.cache-sentinel-settings-badges {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.cache-sentinel-settings-reset {
  padding: 0;
  border: none;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
}
.cache-sentinel-settings-reset:disabled {
  cursor: default;
}
@media (hover: hover) {
  .cache-sentinel-settings-reset:hover:not(:disabled) {
    color: var(--dsw-alias-label-primary);
  }
}
.cache-sentinel-settings-hint,
.cache-sentinel-settings-note {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}
.cache-sentinel-settings-note {
  padding-top: 4px;
}
`;
function head(props, key, state, disabled, labelId, control = null) {
  const m = MESSAGES[props.locale];
  return (0, import_react.createElement)(
    "div",
    { className: "cache-sentinel-settings-head" },
    (0, import_react.createElement)("span", { id: labelId, className: "cache-sentinel-settings-label" }, m.settingsLabels[key]),
    state.overridden ? (0, import_react.createElement)(
      "span",
      { className: "cache-sentinel-settings-badges" },
      (0, import_react.createElement)(import_dsh_client_ui_primitives.Tag, { tone: "neutral" }, m.settingsOverridden),
      (0, import_react.createElement)(
        "button",
        { type: "button", className: "cache-sentinel-settings-reset", disabled, onClick: () => props.resetField(key) },
        m.settingsReset
      )
    ) : null,
    control
  );
}
function SettingsPage(props) {
  const state = props.useSettingsPage((snapshot) => snapshot);
  if (props.view === "summary") return null;
  const m = MESSAGES[props.locale];
  const disabled = !state.writable || state.saving;
  const rows = SETTINGS_FIELDS.map((field) => {
    const key = field.key;
    const id = `cache-sentinel-settings-${key}`;
    const fieldState = state[key];
    switch (field.kind) {
      case "integer":
        return (0, import_react.createElement)(import_dsh_client_ui_primitives.SettingsValueField, {
          key,
          id,
          label: m.settingsLabels[key],
          hint: m.settingsHints[key],
          overriddenLabel: m.settingsOverridden,
          resetLabel: m.settingsReset,
          invalidLabel: m.settingsInvalidInteger(field.min),
          numeric: true,
          disabled,
          text: fieldState.text,
          overridden: fieldState.overridden,
          invalid: fieldState.invalid,
          onEdit: (text) => props.edit(key, text),
          onReset: () => props.resetField(key)
        });
      case "boolean":
        return (0, import_react.createElement)(
          "div",
          { key, className: "cache-sentinel-settings-field", "data-testid": id },
          head(
            props,
            key,
            fieldState,
            disabled,
            `${id}-label`,
            (0, import_react.createElement)(import_dsh_client_ui_primitives.Switch, {
              checked: fieldState.text === "true",
              label: m.settingsLabels[key],
              disabled,
              onChange: (next) => props.edit(key, String(next))
            })
          ),
          (0, import_react.createElement)("p", { className: "cache-sentinel-settings-hint" }, m.settingsHints[key])
        );
      case "mode":
        return (0, import_react.createElement)(
          "div",
          { key, className: "cache-sentinel-settings-field", "data-testid": id },
          head(props, key, fieldState, disabled, `${id}-label`),
          (0, import_react.createElement)(import_dsh_client_ui_primitives.SegmentedControl, {
            id,
            value: asMode(fieldState.text, DEFAULTS.mode),
            options: MODES.map((mode) => ({ value: mode, label: m.settingsModeOptions[mode] })),
            label: m.settingsLabels.mode,
            disabled,
            onChange: (next) => props.edit("mode", next)
          }),
          (0, import_react.createElement)("p", { className: "cache-sentinel-settings-hint" }, m.settingsHints.mode)
        );
      default: {
        const unexpected = field;
        throw new Error(`unknown settings field: ${JSON.stringify(unexpected)}`);
      }
    }
  });
  return (0, import_react.createElement)(
    import_dsh_client_ui_primitives.SettingsForm,
    {
      labels: {
        unavailable: m.settingsUnavailable,
        readOnly: m.settingsReadOnly,
        saveFailed: m.settingsSaveFailed,
        save: m.settingsSave,
        saving: m.settingsSaving
      },
      state,
      onSave: props.save,
      onDiscard: props.discard
    },
    (0, import_react.createElement)("style", null, CSS),
    (0, import_react.createElement)("div", { className: "cache-sentinel-settings-rows" }, ...rows),
    (0, import_react.createElement)("p", { className: "cache-sentinel-settings-note" }, m.settingsStateFileNote)
  );
}

// src/client/index.ts
var name = "cache-sentinel-client";
var inject = ["slots", "remote", "remote.commands"];
var POLL_MS = 3e4;
function browserLocale() {
  return resolveLocale(navigator.languages.length > 0 ? navigator.languages : [navigator.language]);
}
function apply(ctx) {
  const { slots, remote } = ctx;
  const locale = browserLocale();
  slots.inject(
    "conversation.input.dock",
    () => slots.register(
      {
        name: "conversation.input.dock",
        id: "cache-sentinel",
        order: 5,
        inject: (sessionId) => ({
          sessionId,
          locale,
          unlock: () => remote.commands.execute(sessionId, "/unlock", [])
        })
      },
      Banner
    )
  );
  registerSettingsPage(ctx, slots, locale);
}
function registerSettingsPage(ctx, slots, locale) {
  ctx.inject(["configForms"], (child) => {
    const controller = new SettingsPageController(child.configForms.get(ENTRY_ID), locale);
    child.effect(() => () => controller.dispose(), "cache-sentinel: settings form");
    const register = () => {
      const off = slots.inject(
        "plugins.bundle.config",
        () => slots.register({ name: "plugins.bundle.config", key: PACKAGE_NAME, inject: () => controller.face() }, SettingsPage)
      );
      return () => off?.();
    };
    const forms = child.configForms;
    child.effect(
      () => typeof forms.whileServed === "function" ? forms.whileServed([ENTRY_ID], register) : register(),
      "cache-sentinel: settings page"
    );
  });
}
var CSS2 = `
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
  /* \u6587\u9762\u304C\u8907\u6570\u884C\u3067\u3082 1 \u884C\u76EE(\u4E0A\u306E\u4F59\u767D 4px + \u884C\u306E\u9AD8\u3055 20px)\u306E\u4E2D\u592E\u306B\u7F6E\u304F */
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
`;
var ICON_PATHS = {
  warning: ["M12 3.5 2.5 20h19z", "M12 10v4.5", "M12 17.25v.01"],
  info: ["M7 11V7.5a5 5 0 0 1 9.6-1.9", "M5 11h14v10H5z"]
};
function Icon({ tone }) {
  return (0, import_react2.createElement)(
    "span",
    { className: "cache-sentinel-icon", "aria-hidden": true },
    (0, import_react2.createElement)(
      "svg",
      {
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round"
      },
      ...ICON_PATHS[tone].map((d) => (0, import_react2.createElement)("path", { d }))
    )
  );
}
function Banner({ sessionId, locale, unlock }) {
  const [status, setStatus] = (0, import_react2.useState)(void 0);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [failure, setFailure] = (0, import_react2.useState)(void 0);
  const load = (0, import_react2.useCallback)(async () => {
    setStatus(await fetchStatus(sessionId, document.baseURI));
  }, [sessionId]);
  (0, import_react2.useEffect)(() => {
    setStatus(void 0);
    setFailure(void 0);
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
  const banner = bannerFor(status, Date.now(), locale);
  const warning = banner?.tone === "warning";
  (0, import_react2.useEffect)(() => {
    if (!warning) setFailure(void 0);
  }, [warning]);
  if (banner === void 0) return null;
  const onUnlock = async () => {
    setBusy(true);
    setFailure(void 0);
    const result = await runUnlock(unlock, locale);
    if (result !== void 0) console.warn(`[cache-sentinel] \u30D0\u30CA\u30FC\u304B\u3089\u306E /unlock \u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${result}`);
    setFailure(result);
    setBusy(false);
    await load();
  };
  return (0, import_react2.createElement)(
    "div",
    { role: "status", "data-testid": "cache-sentinel-banner", "data-tone": banner.tone, className: "cache-sentinel-banner" },
    (0, import_react2.createElement)("style", null, CSS2),
    (0, import_react2.createElement)(Icon, { tone: banner.tone }),
    (0, import_react2.createElement)(
      "span",
      { className: "cache-sentinel-text" },
      banner.text,
      warning && failure !== void 0 ? (0, import_react2.createElement)("span", { role: "alert", "data-testid": "cache-sentinel-unlock-error", className: "cache-sentinel-failure" }, failure) : null
    ),
    warning ? (0, import_react2.createElement)(
      "button",
      { type: "button", className: "cache-sentinel-button", disabled: busy, onClick: () => void onUnlock() },
      unlockLabel(locale)
    ) : null
  );
}

		return module.exports;
	}
});
