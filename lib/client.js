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
var import_react = require("react");

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
  commandSentinelDescription: "Show cache-sentinel status and switch mode: /sentinel [block|archive|both|off|default]"
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
  commandSentinelDescription: "cache-sentinel \u306E\u72B6\u614B\u8868\u793A\u3068\u30E2\u30FC\u30C9\u5207\u308A\u66FF\u3048: /sentinel [block|archive|both|off|default]"
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
  commandSentinelDescription: "\u663E\u793A cache-sentinel \u72B6\u6001\u5E76\u5207\u6362\u6A21\u5F0F\uFF1A/sentinel [block|archive|both|off|default]"
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
}
var styles = {
  box: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "0 0 8px",
    padding: "8px 12px",
    borderRadius: 12,
    fontSize: 13,
    lineHeight: "20px",
    color: "var(--dsw-alias-label-primary, inherit)"
  },
  warning: { background: "rgba(245, 158, 11, 0.14)", border: "1px solid rgba(245, 158, 11, 0.45)" },
  info: { background: "rgba(59, 130, 246, 0.10)", border: "1px solid rgba(59, 130, 246, 0.35)" },
  text: { flex: 1 },
  failure: { display: "block", marginTop: 4, fontWeight: 600 },
  button: {
    flex: "none",
    padding: "4px 10px",
    borderRadius: 8,
    border: "1px solid currentColor",
    background: "transparent",
    color: "inherit",
    fontSize: 12,
    cursor: "pointer"
  }
};
function Banner({ sessionId, locale, unlock }) {
  const [status, setStatus] = (0, import_react.useState)(void 0);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [failure, setFailure] = (0, import_react.useState)(void 0);
  const load = (0, import_react.useCallback)(async () => {
    setStatus(await fetchStatus(sessionId, document.baseURI));
  }, [sessionId]);
  (0, import_react.useEffect)(() => {
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
  (0, import_react.useEffect)(() => {
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
  return (0, import_react.createElement)(
    "div",
    { role: "status", "data-testid": "cache-sentinel-banner", style: { ...styles.box, ...styles[banner.tone] } },
    (0, import_react.createElement)(
      "span",
      { style: styles.text },
      banner.text,
      warning && failure !== void 0 ? (0, import_react.createElement)("span", { role: "alert", "data-testid": "cache-sentinel-unlock-error", style: styles.failure }, failure) : null
    ),
    warning ? (0, import_react.createElement)("button", { type: "button", style: styles.button, disabled: busy, onClick: () => void onUnlock() }, unlockLabel(locale)) : null
  );
}

		return module.exports;
	}
});
