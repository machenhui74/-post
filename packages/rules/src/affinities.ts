import type { EngineId, PlatformId, TopicSession } from "@geopost/shared";
import { CHECKLIST_IDS, PLATFORM_IDS } from "@geopost/shared";
import raw from "./engine-affinities.json";
import { getRule } from "./catalog.js";

const table = raw as Record<EngineId, PlatformId[]>;

export function engineAffinityTable(): Record<EngineId, PlatformId[]> {
  return table;
}

/** 多引擎取并集；未选引擎则退回各站 defaultSelected。 */
export function platformsForEngines(engines: EngineId[]): PlatformId[] {
  if (!engines.length) {
    return PLATFORM_IDS.filter((id) => getRule(id).defaultSelected && !CHECKLIST_IDS.includes(id));
  }
  const set = new Set<PlatformId>();
  for (const eng of engines) {
    for (const id of table[eng] ?? []) set.add(id);
  }
  return PLATFORM_IDS.filter((id) => set.has(id) && !CHECKLIST_IDS.includes(id));
}

/** 按目标引擎改 session 勾选；清单站保持原样。 */
export function applyEngineSelection(session: TopicSession, engines: EngineId[]): void {
  const allow = new Set(platformsForEngines(engines));
  for (const id of PLATFORM_IDS) {
    if (CHECKLIST_IDS.includes(id)) continue;
    session.platforms[id].selected = engines.length === 0 ? getRule(id).defaultSelected : allow.has(id);
  }
  session.targetEngines = engines;
}
