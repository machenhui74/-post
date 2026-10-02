import { PLATFORM_IDS, type PlatformId } from "@geopost/shared";
import raw from "./platform-rules.json";
import type { PlatformRule, PlatformRuleMap } from "./types.js";

const rules = raw as PlatformRuleMap;

export function getRule(id: PlatformId): PlatformRule {
  const rule = rules[id];
  if (!rule) {
    throw new Error(`未知平台: ${id}`);
  }
  return rule;
}

export function listRules(): PlatformRule[] {
  return Object.values(rules);
}

export function getEditorUrl(id: PlatformId): string {
  return getRule(id).editorUrl;
}

export function getLoginUrl(id: PlatformId): string {
  return getRule(id).loginUrl;
}

export function isPublishRule(id: PlatformId): boolean {
  return getRule(id).kind !== "checklist";
}

/** Agent「全平台」= 可代提交的站，不含百科/官网清单。 */
export function publishablePlatformIds(): PlatformId[] {
  return PLATFORM_IDS.filter(isPublishRule);
}
