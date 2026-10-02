import { validatePublishJob, knowledgePlainText, platformSkipReasons } from "@geopost/rules";
import { PLATFORM_IDS, type PlatformId, type TopicSession, type ValidationResult } from "@geopost/shared";
import { logger } from "./logger.js";
import { getBrand, getSettings, knowledgeForGenerate } from "./store.js";

function sessionValidateInput(session: TopicSession, selectedIds?: PlatformId[]) {
  const allow = selectedIds ? new Set(selectedIds) : null;
  return {
    drafts: Object.values(session.platforms).map((d) =>
      allow ? { ...d, selected: allow.has(d.platform) } : d,
    ),
    usedGenerative: true,
    toutiaoFirstPublishUntil: getSettings().toutiaoFirstPublishUntil,
    brand: getBrand(),
    masterMarkdown: `${session.master.title}\n${session.master.summary}\n${session.master.markdown}`,
    knowledgeMarkdown: knowledgePlainText(knowledgeForGenerate(session.knowledgeIds)),
  };
}

/** UI / MCP / 执行器共用，带上跨任务的头条首发窗口与事实卡保真。 */
export function validateSession(session: TopicSession): ValidationResult {
  return validatePublishJob(sessionValidateInput(session));
}

export interface FillPlan {
  fillable: PlatformId[];
  skipped: Array<{ platform: PlatformId; reasons: string[] }>;
  issues: ValidationResult;
  /** 拟填入子集是否还过得了互斥原创等整批规则。 */
  subsetOk: boolean;
}

/**
 * 缺封面等站级错误只跳过那一家；子集再跑一遍互斥规则，过了就能先填能填的。
 */
export function planPartialFill(session: TopicSession): FillPlan {
  const issues = validateSession(session);
  const skipMap = platformSkipReasons(issues);
  const selected = PLATFORM_IDS.filter((id) => session.platforms[id]?.selected);
  const proposed = selected.filter((id) => !skipMap.has(id));
  const skipped = selected
    .filter((id) => skipMap.has(id))
    .map((platform) => ({ platform, reasons: skipMap.get(platform) ?? [] }));

  if (proposed.length === 0) {
    logger.info("fill.plan", { fillable: 0, skipped: skipped.length, subsetOk: false });
    return { fillable: [], skipped, issues, subsetOk: false };
  }

  const subset = validatePublishJob(sessionValidateInput(session, proposed));
  logger.info("fill.plan", {
    fillable: proposed.length,
    skipped: skipped.length,
    subsetOk: subset.ok,
    subsetErrors: subset.errors.map((e) => e.code),
  });
  if (!subset.ok) {
    return { fillable: [], skipped, issues: { ...issues, errors: [...issues.errors, ...subset.errors] }, subsetOk: false };
  }
  return { fillable: proposed, skipped, issues, subsetOk: true };
}
