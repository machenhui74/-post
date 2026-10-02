import type { BrandProfile, PlatformDraft, PlatformId, PlatformUiPrefs, ValidationIssue, ValidationResult } from "@geopost/shared";
import { PLATFORM_IDS, TENCENT_FAMILY } from "@geopost/shared";
import { missingExtractBlocks } from "./extract.js";
import { fidelityWarnings } from "./fidelity.js";
import { scanCopy, scanHonesty } from "./scan.js";
import { getRule, listRules } from "./catalog.js";

function countZh(text: string): number {
  return Array.from(text.trim()).length;
}

function fieldIssues(
  label: string,
  text: string,
  limit: { min: number; max: number },
  platform: PlatformId,
): ValidationIssue[] {
  const n = countZh(text);
  if (n < limit.min) {
    return [{ code: "TOO_SHORT", message: `${label}仅 ${n} 字，最少 ${limit.min}。`, platform }];
  }
  if (n > limit.max) {
    return [{ code: "TOO_LONG", message: `${label} ${n} 字，最多 ${limit.max}。`, platform }];
  }
  return [];
}

export interface ValidateInput {
  drafts: PlatformDraft[];
  /** 主题生成/生图后视为使用了生成合成内容。 */
  usedGenerative: boolean;
  /** 历史任务里头条首发的窗口截止（ISO），跨任务仍拦截外发。 */
  toutiaoFirstPublishUntil?: string;
  now?: number;
  brand?: BrandProfile | null;
  masterMarkdown?: string;
  /** 勾选知识库纯文本，保真比对时数字算合法来源。 */
  knowledgeMarkdown?: string;
}

/**
 * UI 与 MCP 共用。硬拦截必须挡住假原创、首发互斥和 AI 去标。
 */
export function validatePublishJob(input: ValidateInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const selected = input.drafts.filter((d) => d.selected);
  // 产品路径永远 draft，publishing 为空，头条首发窗口不会拦填表。
  const publishing = selected.filter((d) => d.mode === "publish");

  if (selected.length === 0) {
    errors.push({ code: "NO_TARGET", message: "至少选择一个平台。" });
  }

  const originals = selected.filter((d) => d.claimOriginal);
  const firsts = selected.filter((d) => d.claimFirstPublish);
  const exclusives = selected.filter((d) => d.claimExclusive);

  if (selected.length > 1 && originals.length === selected.length) {
    errors.push({
      code: "BATCH_ORIGINAL",
      message: "禁止一次任务给全部平台勾选原创。只允许真正首发的那一家声明原创。",
    });
  }
  if (firsts.length > 1) {
    errors.push({ code: "MULTI_FIRST", message: "一次任务只能有一个平台勾选首发。" });
  }
  if (exclusives.length > 1) {
    errors.push({ code: "MULTI_EXCLUSIVE", message: "一次任务只能有一个平台勾选独家。" });
  }

  const toutiao = selected.find((d) => d.platform === "toutiao");
  if (toutiao?.aiDeclared && toutiao.claimOriginal) {
    errors.push({
      code: "TOUTIAO_AI_ORIGINAL",
      message: "头条官方禁止将 AI 创作内容声明原创。",
      platform: "toutiao",
    });
  }
  if (toutiao?.claimFirstPublish && publishing.some((d) => d.platform !== "toutiao")) {
    errors.push({
      code: "TOUTIAO_FIRST_WINDOW",
      message: "勾选头条首发后，本次不能再向其他平台投递「发布」（存草稿可以）。",
      platform: "toutiao",
    });
  }

  const windowUntil = input.toutiaoFirstPublishUntil;
  const now = input.now ?? Date.now();
  if (windowUntil && Date.parse(windowUntil) > now) {
    const othersPublishing = publishing.filter((d) => d.platform !== "toutiao");
    if (othersPublishing.length > 0) {
      errors.push({
        code: "TOUTIAO_FIRST_WINDOW",
        message: `头条首发窗口未结束（截止 ${windowUntil}），其他平台本次只能存草稿。`,
        platform: "toutiao",
      });
    }
  }

  const qie = selected.find((d) => d.platform === "qiehao");
  if (
    qie?.claimExclusive &&
    selected.some((d) => !TENCENT_FAMILY.includes(d.platform))
  ) {
    errors.push({
      code: "QIE_EXCLUSIVE",
      message: "企鹅号独家意味着不能同时向非腾讯系平台提交（公众号除外）。",
      platform: "qiehao",
    });
  }

  if (input.usedGenerative) {
    for (const draft of selected) {
      const rule = getRule(draft.platform);
      if (rule.kind === "checklist") continue;
      if (!draft.aiDeclared) {
        errors.push({
          code: "AI_UNDECLARED",
          message: "使用了生成或生图，必须勾选该平台的 AI/作品声明。",
          platform: draft.platform,
        });
      }
    }
  }

  for (const draft of selected) {
    const rule = getRule(draft.platform);
    if (rule.kind === "checklist") {
      warnings.push({
        code: "CHECKLIST_MANUAL",
        message: `${rule.label}不会自动发表，只会打开维护页。`,
        platform: draft.platform,
      });
      continue;
    }
    errors.push(...fieldIssues("标题", draft.title, rule.title, draft.platform));
    errors.push(...fieldIssues("正文", draft.markdown, rule.body, draft.platform));
    if (rule.summary.required) {
      errors.push(...fieldIssues("摘要", draft.summary, { min: 8, max: rule.summary.max }, draft.platform));
    } else if (draft.summary) {
      errors.push(...fieldIssues("摘要", draft.summary, { min: 0, max: rule.summary.max }, draft.platform));
    }

    if (rule.cover.required && draft.coverAssetIds.length < rule.cover.minCount) {
      errors.push({
        code: "COVER_REQUIRED",
        message: `${rule.label}需要封面（至少 ${rule.cover.minCount} 张）。`,
        platform: draft.platform,
      });
    }
    if (draft.coverAssetIds.length > rule.cover.maxCount) {
      errors.push({
        code: "COVER_TOO_MANY",
        message: `${rule.label}封面最多 ${rule.cover.maxCount} 张。`,
        platform: draft.platform,
      });
    }
    if (rule.cover.mustBeInBody && draft.coverAssetIds.length > 0 && !draft.markdown.includes(draft.coverAssetIds[0] ?? "")) {
      warnings.push({
        code: "COVER_NOT_IN_BODY",
        message: "企鹅号要求封面来自正文图。请确认封面图已插入正文。",
        platform: draft.platform,
      });
    }
    if (draft.claimOriginal && !rule.supports.original) {
      errors.push({
        code: "ORIGINAL_UNSUPPORTED",
        message: `${rule.label}没有分成型原创开关，请取消勾选。`,
        platform: draft.platform,
      });
    }
    if (draft.claimFirstPublish && !rule.supports.firstPublish) {
      errors.push({
        code: "FIRST_UNSUPPORTED",
        message: `${rule.label}不支持首发开关。`,
        platform: draft.platform,
      });
    }
    if (draft.claimExclusive && !rule.supports.exclusive) {
      errors.push({
        code: "EXCLUSIVE_UNSUPPORTED",
        message: `${rule.label}不支持独家开关。`,
        platform: draft.platform,
      });
    }
    if (draft.platform === "baijiahao" && draft.claimOriginal) {
      warnings.push({
        code: "BJH_ORIGINAL_WARN",
        message: "百家号误标原创可能永久取消原创权，请二次确认后再提交。",
        platform: "baijiahao",
      });
    }

    const scanned = scanCopy(`${draft.title}\n${draft.summary}\n${draft.markdown}`, draft.platform);
    errors.push(...scanned);
    const body = `${draft.title}\n${draft.summary}\n${draft.markdown}`;
    warnings.push(...scanHonesty(body, input.brand, draft.platform));
    warnings.push(...fidelityWarnings(body, draft.platform, input.brand, `${input.masterMarkdown ?? ""}\n${input.knowledgeMarkdown ?? ""}`));
    warnings.push(
      ...missingExtractBlocks(draft.markdown, getRule(draft.platform).extractBlocks ?? [], draft.platform, input.brand),
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** 有 platform 的硬错误只挡住那一家，不拦整批。 */
export function platformSkipReasons(issues: ValidationResult): Map<PlatformId, string[]> {
  const map = new Map<PlatformId, string[]>();
  for (const e of issues.errors) {
    if (!e.platform) continue;
    const rows = map.get(e.platform) ?? [];
    rows.push(e.message);
    map.set(e.platform, rows);
  }
  return map;
}

/**
 * 填入成功后清空正文并取消勾选，分类/声明留下次还能用。
 */
export function clearFilledCopy(draft: PlatformDraft): PlatformDraft {
  return {
    ...draft,
    title: "",
    markdown: "",
    summary: "",
    coverAssetIds: [],
    selected: false,
  };
}

export function emptyDraft(platform: PlatformId): PlatformDraft {
  const rule = getRule(platform);
  return {
    platform,
    title: "",
    markdown: "",
    summary: "",
    coverAssetIds: [],
    category: rule.categories[0] ?? "",
    tags: [],
    location: "",
    extras: {},
    aiDeclared: true,
    claimOriginal: false,
    claimFirstPublish: false,
    claimExclusive: false,
    mode: "draft",
    selected: rule.defaultSelected ?? rule.kind !== "checklist",
  };
}

/**
 * 只覆盖分类/位置/声明/是否参与，不碰标题正文。
 * 分类必须在规则候选或登录后扫到的后台列表里，避免脏值写进稿。
 */
export function applyPlatformUiPrefs(
  draft: PlatformDraft,
  prefs?: PlatformUiPrefs | null,
  allowedCategories?: string[],
): PlatformDraft {
  if (!prefs) return draft;
  const rule = getRule(draft.platform);
  const next = { ...draft };
  if (typeof prefs.selected === "boolean") next.selected = prefs.selected;
  const cats = new Set([...(allowedCategories ?? []), ...rule.categories]);
  if (prefs.category && cats.has(prefs.category)) next.category = prefs.category;
  if (typeof prefs.location === "string") next.location = prefs.location;
  if (prefs.extras && typeof prefs.extras === "object") {
    next.extras = { ...next.extras, ...prefs.extras };
    if (!next.location) {
      const loc = Object.entries(next.extras).find(([k]) => /位置/.test(k))?.[1];
      if (loc) next.location = loc;
    }
  }
  if (typeof prefs.aiDeclared === "boolean") next.aiDeclared = prefs.aiDeclared;
  if (typeof prefs.claimOriginal === "boolean" && rule.supports.original) next.claimOriginal = prefs.claimOriginal;
  if (typeof prefs.claimFirstPublish === "boolean" && rule.supports.firstPublish) {
    next.claimFirstPublish = prefs.claimFirstPublish;
  }
  if (typeof prefs.claimExclusive === "boolean" && rule.supports.exclusive) next.claimExclusive = prefs.claimExclusive;
  return next;
}

export function snapshotPlatformUiPrefs(draft: PlatformDraft): PlatformUiPrefs {
  return {
    selected: draft.selected,
    category: draft.category,
    location: draft.location,
    extras: draft.extras,
    aiDeclared: draft.aiDeclared,
    claimOriginal: draft.claimOriginal,
    claimFirstPublish: draft.claimFirstPublish,
    claimExclusive: draft.claimExclusive,
  };
}

export function uiPrefsChanged(a: PlatformDraft, b: PlatformDraft): boolean {
  return (
    a.selected !== b.selected ||
    a.category !== b.category ||
    (a.location ?? "") !== (b.location ?? "") ||
    JSON.stringify(a.extras ?? {}) !== JSON.stringify(b.extras ?? {}) ||
    a.aiDeclared !== b.aiDeclared ||
    a.claimOriginal !== b.claimOriginal ||
    a.claimFirstPublish !== b.claimFirstPublish ||
    a.claimExclusive !== b.claimExclusive
  );
}

export function defaultDrafts(): Record<PlatformId, PlatformDraft> {
  return Object.fromEntries(PLATFORM_IDS.map((id) => [id, emptyDraft(id)])) as Record<
    PlatformId,
    PlatformDraft
  >;
}

export function orderedPlatforms(): PlatformId[] {
  return [...listRules()].sort((a, b) => a.geoOrder - b.geoOrder).map((r) => r.id);
}
