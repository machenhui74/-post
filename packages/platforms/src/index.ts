import type { AccountInfo, PlatformId, PublishTarget, TaskResult } from "@geopost/shared";
import { getEditorUrl, getLoginUrl, getRule } from "@geopost/rules";

/** 扩展侧实现；server 只按 platform 发指令。 */
export interface PlatformAdapter {
  id: PlatformId;
  probeAccount(): Promise<AccountInfo>;
  fillEditor(target: PublishTarget): Promise<TaskResult>;
}

export function editorUrl(id: PlatformId): string {
  return getEditorUrl(id);
}

export function loginUrl(id: PlatformId): string {
  return getLoginUrl(id);
}

export function platformMeta(id: PlatformId) {
  return getRule(id);
}
