import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createId,
  nowIso,
  PLATFORM_IDS,
  type AiProviderId,
  type Asset,
  type EngineId,
  type PlatformId,
  type PlatformReview,
  type TopicSession,
} from "@geopost/shared";
import {
  applyEngineSelection,
  applyPlatformUiPrefs,
  emptyDraft,
  fidelityWarnings,
  flattenCategoryLabels,
  getRule,
  knowledgePlainText,
  missingExtractBlocks,
  scanHonesty,
} from "@geopost/rules";
import { generateBundle, generateImage, reviewAndFixPlatformDraft, rewritePlatformDraft } from "./ai.js";
import { validateSession } from "./compliance.js";
import { logger } from "./logger.js";
import { appendRewriteLog, getBrand, getEditorCatalog, getSettings, knowledgeForGenerate, paths, questionsByIds, saveSession } from "./store.js";

const HIGH_VALUE: PlatformId[] = ["zhihu", "weixin", "website"];

function liveCategories(id: PlatformId): string[] {
  return flattenCategoryLabels(getEditorCatalog(id)?.categories);
}

export interface GenerateOpts {
  questionIds?: string[];
  targetEngines?: EngineId[];
  /** 控制台右侧勾选的站；有值时只为这些站生成正文。 */
  platforms?: PlatformId[];
  /** topic=手输主题；random_question=问题库抽一题。只用于审计。 */
  source?: "topic" | "random_question";
  /** 勾选的知识库 id；空数组=不参考；缺省=磁盘上当前勾选。 */
  knowledgeIds?: string[];
}

export function createBlankSession(topic = ""): TopicSession {
  const settings = getSettings();
  const prefs = settings.platformPrefs ?? {};
  const platforms = defaultDraftsSafe();
  for (const id of PLATFORM_IDS) {
    platforms[id] = applyPlatformUiPrefs(platforms[id], prefs[id], liveCategories(id));
  }
  // 右侧勾选用完整列表恢复，避免只写下了一家、其余又跳回默认。
  if (Array.isArray(settings.lastPlatforms)) {
    const allow = new Set(settings.lastPlatforms);
    for (const id of PLATFORM_IDS) {
      platforms[id].selected = allow.has(id);
    }
    logger.info("session.restore_platforms", { n: settings.lastPlatforms.length, ids: settings.lastPlatforms });
  }
  return {
    id: createId("ses"),
    topic,
    provider: "openai",
    model: "",
    master: { title: "", markdown: "", summary: "" },
    platforms,
    assets: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function defaultDraftsSafe() {
  return Object.fromEntries(PLATFORM_IDS.map((id) => [id, emptyDraft(id)])) as TopicSession["platforms"];
}

export function addUploadedAsset(session: TopicSession, filename: string, mimeType: string, buf: Buffer): Asset {
  const id = createId("img");
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : ".bin";
  const stored = `${id}${ext}`;
  writeFileSync(join(paths.assetsDir, stored), buf);
  const asset: Asset = {
    id,
    kind: "image",
    source: "upload",
    filename: stored,
    mimeType,
    relPath: `assets/${stored}`,
    createdAt: nowIso(),
  };
  session.assets.push(asset);
  logger.info("asset.uploaded", { sessionId: session.id, id });
  return asset;
}

function geoSoftCount(
  platform: PlatformId,
  title: string,
  summary: string,
  markdown: string,
  master: string,
  knowledgeText = "",
): { n: number; missing: string[]; hasDrift: boolean } {
  const body = `${title}\n${summary}\n${markdown}`;
  const brand = getBrand();
  const honesty = scanHonesty(body, brand, platform);
  const fidelity = fidelityWarnings(body, platform, brand, `${master}\n${knowledgeText}`);
  const blocks = missingExtractBlocks(markdown, getRule(platform).extractBlocks ?? [], platform, brand);
  const all = [...honesty, ...fidelity, ...blocks];
  const missing = (getRule(platform).extractBlocks ?? []).filter((b) =>
    blocks.some((i) => i.message.includes(`「${b}」`)),
  );
  return {
    n: all.length,
    missing,
    hasDrift: fidelity.some((i) => i.code === "FACT_DRIFT" || i.code === "UNKNOWN_FACT"),
  };
}

async function maybeRewriteHighValue(
  session: TopicSession,
  provider: AiProviderId,
  model: string | undefined,
): Promise<void> {
  const brand = getBrand();
  const master = `${session.master.title}\n${session.master.summary}\n${session.master.markdown}`;
  const knowledge = knowledgeForGenerate(session.knowledgeIds);
  const kbText = knowledgePlainText(knowledge);
  const log: TopicSession["rewriteLog"] = [];

  for (const id of HIGH_VALUE) {
    const draft = session.platforms[id];
    if (!draft?.selected) continue;
    const before = geoSoftCount(id, draft.title, draft.summary, draft.markdown, master, kbText);
    if (before.n === 0) continue;
    const rewritten = await rewritePlatformDraft(
      {
        platform: id,
        topic: session.topic,
        title: draft.title,
        summary: draft.summary,
        markdown: draft.markdown,
        missing: before.missing.length ? before.missing : getRule(id).extractBlocks,
        brand,
        knowledge,
      },
      provider,
      model,
    );
    if (!rewritten) continue;
    const after = geoSoftCount(id, rewritten.title, rewritten.summary, rewritten.markdown, master, kbText);
    // 保真门：改出新数字就丢；否则取软警告更少的版本。
    const take = !after.hasDrift && after.n < before.n;
    if (take) {
      draft.title = rewritten.title;
      draft.summary = rewritten.summary;
      draft.markdown = rewritten.markdown;
    }
    const entry = {
      platform: id,
      editType: "Structure" as const,
      opPattern: "add-extract-blocks",
      validateOk: take && after.n === 0,
      at: nowIso(),
    };
    log.push(entry);
    appendRewriteLog(entry);
    logger.info("session.rewrite_select", { platform: id, take, before: before.n, after: after.n });
  }
  session.rewriteLog = log;
}

export async function generateSession(
  topic: string,
  provider: AiProviderId,
  model: string | undefined,
  generateImages: boolean,
  opts: GenerateOpts = {},
): Promise<TopicSession> {
  const brand = getBrand();
  const questions = opts.questionIds?.length ? questionsByIds(opts.questionIds) : [];
  const knowledge = knowledgeForGenerate(opts.knowledgeIds);
  const engines = opts.targetEngines ?? [];
  const requested = (opts.platforms ?? []).filter((id) => PLATFORM_IDS.includes(id));
  if (opts.platforms && requested.length === 0) {
    throw new Error("请先在右侧勾选要生成的平台。");
  }
  const targetIds = requested.length ? requested : undefined;
  logger.info("session.facts_injected", {
    topic,
    source: opts.source ?? "topic",
    brand: brand.name,
    facts: brand.facts.length,
    questions: questions.length,
    knowledge: knowledge.length,
    engines,
    platforms: targetIds,
  });

  const session = createBlankSession(topic);
  session.provider = provider;
  session.questionIds = questions.map((q) => q.id);
  session.knowledgeIds = knowledge.map((d) => d.id);
  if (targetIds) {
    for (const id of PLATFORM_IDS) {
      session.platforms[id].selected = targetIds.includes(id);
    }
  } else {
    applyEngineSelection(session, engines);
  }

  const { parsed, model: used } = await generateBundle(
    { topic, brand, questions, engines, platforms: targetIds, knowledge },
    provider,
    model,
  );
  session.model = used;
  session.master = {
    title: parsed.master?.title ?? topic,
    summary: parsed.master?.summary ?? "",
    markdown: parsed.master?.markdown ?? "",
  };

  if (generateImages) {
    for (const prompt of parsed.imagePrompts ?? []) {
      const asset = await generateImage(prompt);
      if (asset) session.assets.push(asset);
    }
    if (session.assets.length === 0) {
      logger.error("session.images_empty", { topic, provider });
      throw new Error(
        "已勾选 AI 生图但一张都没有。请在 .env 把 IMAGE_PROVIDER 设为 openai（不要 none）并填写 OPENAI_API_KEY，或改为本地上传。",
      );
    }
  }

  const firstCover = session.assets[0];
  const selectedMap = Object.fromEntries(PLATFORM_IDS.map((id) => [id, session.platforms[id].selected]));
  const generateIds = targetIds ?? PLATFORM_IDS;
  const uiPrefs = getSettings().platformPrefs ?? {};
  for (const id of PLATFORM_IDS) {
    const rule = getRule(id);
    const selected = selectedMap[id] ?? rule.defaultSelected;
    // 未勾选的站不填生成正文，避免一次写 13 份。
    if (!generateIds.includes(id)) {
      session.platforms[id] = applyPlatformUiPrefs({ ...emptyDraft(id), selected: false }, uiPrefs[id], liveCategories(id));
      session.platforms[id].selected = false;
      continue;
    }
    const extraCats = liveCategories(id);
    const piece = parsed.platforms?.[id];
    const draft = applyPlatformUiPrefs(
      {
        ...emptyDraft(id),
        title: piece?.title ?? session.master.title.slice(0, rule.title.max),
        summary: piece?.summary ?? session.master.summary.slice(0, rule.summary.max),
        markdown: piece?.markdown ?? session.master.markdown,
        category:
          piece?.category && (rule.categories.includes(piece.category) || extraCats.includes(piece.category))
            ? piece.category
            : rule.categories[0] ?? "",
        tags: piece?.tags ?? [],
        coverAssetIds: firstCover ? [firstCover.id] : [],
        aiDeclared: true,
        claimOriginal: false,
        claimFirstPublish: false,
        claimExclusive: false,
        mode: "draft",
        selected,
      },
      uiPrefs[id],
      extraCats,
    );
    // 本次右侧勾选优先于历史 prefs.selected。
    draft.selected = selected;
    session.platforms[id] = draft;
  }

  // 企鹅号封面必须来自正文图；用可预览的本地 URL，发布时再转 data URL
  if (firstCover && session.platforms.qiehao.selected && !session.platforms.qiehao.markdown.includes(firstCover.id)) {
    session.platforms.qiehao.markdown = `![封面](/api/assets/${firstCover.filename})\n\n${session.platforms.qiehao.markdown}`;
  }

  await maybeRewriteHighValue(session, provider, model);

  saveSession(session);
  logger.info("session.generated", {
    id: session.id,
    images: session.assets.length,
    engines,
    platforms: generateIds,
  });
  return session;
}

const TEXT_FIXABLE = new Set([
  "TOO_SHORT",
  "TOO_LONG",
  "CLICKBAIT",
  "GUIDE_CONTACT",
  "MEDICAL_CLAIM",
  "FINANCE_PITCH",
  "NEWS_VOICE",
  "MISSING_BLOCK",
  "UNIQUE_CLAIM",
]);

function platformIssueLines(session: TopicSession, platform: PlatformId): string[] {
  const issues = validateSession(session);
  return [...issues.errors, ...issues.warnings]
    .filter((i) => !i.platform || i.platform === platform)
    .map((i) => `${i.code}: ${i.message}`);
}

/**
 * 填入前对已勾选站按发文标准审核；不合格则改写。封面等改不了的留在 unfixed。
 */
export async function reviewSelectedDrafts(
  session: TopicSession,
  provider: AiProviderId,
  model?: string,
): Promise<PlatformReview[]> {
  const brand = getBrand();
  const master = `${session.master.title}\n${session.master.summary}\n${session.master.markdown}`;
  const knowledge = knowledgeForGenerate(session.knowledgeIds);
  const kbText = knowledgePlainText(knowledge);
  const reviews: PlatformReview[] = [];
  const selected = PLATFORM_IDS.filter((id) => session.platforms[id]?.selected);
  logger.info("session.review.start", { sessionId: session.id, n: selected.length, provider });

  for (const id of selected) {
    const draft = session.platforms[id];
    if (!draft.markdown.trim() && !draft.title.trim()) {
      reviews.push({ platform: id, action: "unfixed", notes: ["该站还没有稿，无法审核。"] });
      continue;
    }
    const issues = platformIssueLines(session, id);
    const result = await reviewAndFixPlatformDraft(
      {
        platform: id,
        topic: session.topic,
        title: draft.title,
        summary: draft.summary,
        markdown: draft.markdown,
        issues,
        brand,
        knowledge,
      },
      provider,
      model,
    );
    if (!result) {
      reviews.push({ platform: id, action: "unfixed", notes: ["模型审核失败，仍用原稿。", ...issues] });
      continue;
    }
    if (result.pass) {
      reviews.push({ platform: id, action: "pass", notes: result.notes.length ? result.notes : ["已按该站标准复核，可填入。"] });
      logger.info("session.review.pass", { platform: id });
      continue;
    }
    const after = geoSoftCount(id, result.title, result.summary, result.markdown, master, kbText);
    if (after.hasDrift) {
      reviews.push({
        platform: id,
        action: "unfixed",
        notes: ["改写引入了事实卡没有的数字，已丢弃改写。", ...result.notes, ...result.unfixed],
      });
      logger.warn("session.review.drift", { platform: id });
      continue;
    }
    draft.title = result.title;
    draft.summary = result.summary;
    draft.markdown = result.markdown;
    const leftover = validateSession(session)
      .errors.filter((i) => i.platform === id && TEXT_FIXABLE.has(i.code))
      .map((i) => `${i.code}: ${i.message}`);
    const notes = [...result.notes, ...result.unfixed];
    if (leftover.length) {
      reviews.push({ platform: id, action: "unfixed", notes: [...notes, ...leftover] });
      logger.warn("session.review.still_bad", { platform: id, leftover: leftover.length });
    } else {
      reviews.push({
        platform: id,
        action: "fixed",
        notes: notes.length ? notes : ["已按该站发文标准改写。"],
      });
      logger.info("session.review.fixed", { platform: id });
    }
  }

  saveSession(session);
  logger.info("session.review.done", {
    sessionId: session.id,
    pass: reviews.filter((r) => r.action === "pass").length,
    fixed: reviews.filter((r) => r.action === "fixed").length,
    unfixed: reviews.filter((r) => r.action === "unfixed").length,
  });
  return reviews;
}

export function patchPlatform(session: TopicSession, platform: PlatformId, patch: Record<string, unknown>): TopicSession {
  session.platforms[platform] = { ...session.platforms[platform], ...patch, platform };
  return saveSession(session);
}
