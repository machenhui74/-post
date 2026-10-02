import { z } from "zod";
import {
  AI_PROVIDER_IDS,
  PLATFORM_IDS,
  PLATFORM_LABELS,
  applyIsAutoPublish,
  isChecklistPlatform,
  type PlatformId,
  type PublishJob,
  type TopicSession,
} from "@geopost/shared";
import { clearFilledCopy, isPublishRule, listRules, publishablePlatformIds } from "@geopost/rules";
import { extensionConnected } from "./bridge.js";
import { planPartialFill } from "./compliance.js";
import { logger } from "./logger.js";
import { executeJob } from "./publisher.js";
import { createBlankSession, generateSession, addUploadedAsset } from "./sessions.js";
import { getSession, saveSession } from "./store.js";

const PlatformIdSchema = z.enum(PLATFORM_IDS);

/** Agent 填入官方编辑器：confirm 必须为 true，等同控制台填入确认。 */
export const AgentDispatchSchema = z.object({
  confirm: z.literal(true),
  /** all = 全部可发平台；字符串 = 单平台；数组 = 指定几家。 */
  platforms: z.union([z.literal("all"), PlatformIdSchema, z.array(PlatformIdSchema).min(1)]),
  mode: z.enum(["draft", "publish"]).optional(),
  /** 已废弃。产品永不点官方发布；传 true 会被忽略。 */
  isAutoPublish: z.boolean().optional(),
  sessionId: z.string().optional(),
  topic: z.string().optional(),
  title: z.string().optional(),
  markdown: z.string().optional(),
  summary: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  aiDeclared: z.boolean().optional(),
  claimOriginal: z.boolean().optional(),
  claimFirstPublish: z.boolean().optional(),
  claimExclusive: z.boolean().optional(),
  baijiahaoOriginalAck: z.boolean().optional(),
  provider: z.enum(AI_PROVIDER_IDS).optional(),
  model: z.string().optional(),
  generateImages: z.boolean().optional(),
  /** 目标 AI 引擎，生成时按信源亲和默认勾选平台。 */
  targetEngines: z.array(z.enum(["doubao", "yuanbao", "deepseek", "kimi", "wenxin", "qwen"])).optional(),
  questionIds: z.array(z.string()).optional(),
  knowledgeIds: z.array(z.string()).optional(),
  /** 可选封面，data URL 或纯 base64；多数门户号没封面过不了校验。 */
  coverBase64: z.string().optional(),
  coverMimeType: z.string().optional(),
});

export type AgentDispatchInput = z.infer<typeof AgentDispatchSchema>;

/**
 * Agent 先 GET 本对象即可调用，不必另读说明书。
 */
export function agentCatalog() {
  return {
    name: "GeoPost Agent API",
    version: "1",
    instruction:
      "本 JSON 就是说明书。先 GET /api/health，extensionPing 为 true 再 POST /api/agent/dispatch。Cookie 不出浏览器。控制台/Agent 只分发：选平台、校验、开官方编辑器并填表。扩展不点发布。成功看标题/正文/封面/声明填没填上。",
    base: "http://127.0.0.1:8787",
    preconditions: [
      "本机服务已启动（pnpm dev）",
      "Chrome 已加载 GeoPost 网关且角标 ON",
      "目标平台已在浏览器登录创作者后台",
    ],
    endpoints: {
      spec: { method: "GET", path: "/api/agent", desc: "本契约" },
      health: { method: "GET", path: "/api/health", desc: "server / extension / extensionPing" },
      accounts: { method: "GET", path: "/api/accounts", desc: "各平台登录态" },
      platforms: { method: "GET", path: "/api/platforms", desc: "字数、封面、分类规则" },
      dispatch: { method: "POST", path: "/api/agent/dispatch", desc: "选平台后填入官方编辑器（不点发布）" },
      job: { method: "GET", path: "/api/jobs/:id", desc: "查询任务结果" },
    },
    dispatch: {
      contentType: "application/json",
      required: ["confirm", "platforms"],
      contentOneOf: ["sessionId", "topic", "title+markdown"],
      fields: {
        confirm: { type: "true", required: true, desc: "必须字面 true，等同控制台填入确认" },
        platforms: {
          type: '"all" | platformId | platformId[]',
          required: true,
          desc: "all=全部可填表平台（不含百科/官网）；单字符串=一家；数组=指定几家",
        },
        mode: { type: '"draft" | "publish"', required: false, default: "draft", desc: "兼容字段。publish 会被忽略，永远只填表" },
        isAutoPublish: {
          type: "boolean",
          required: false,
          default: false,
          desc: "已废弃。传 true 也会被忽略。填表站停在编辑器；微信/B站专栏/百家号存草稿并打开编辑页。",
        },
        sessionId: { type: "string", required: false, desc: "已有分发会话，用各平台已改写稿" },
        topic: { type: "string", required: false, desc: "按主题生成各平台独立稿再填入编辑器" },
        title: { type: "string", required: false, desc: "与 markdown 成对，原文填入所选平台编辑器" },
        markdown: { type: "string", required: false, desc: "正文 Markdown，须满足目标站最少字数" },
        summary: { type: "string", required: false, desc: "搜狐等站必填，见 platforms[].summary" },
        category: { type: "string", required: false, desc: "须落在该站 categories 里" },
        tags: { type: "string[]", required: false },
        aiDeclared: { type: "boolean", required: false, default: true, desc: "生成/生图后必须为 true" },
        claimOriginal: { type: "boolean", required: false, default: false, desc: "禁止一次给全部平台勾原创" },
        claimFirstPublish: { type: "boolean", required: false, default: false, desc: "一次任务最多一家" },
        claimExclusive: { type: "boolean", required: false, default: false, desc: "企鹅独家不能同时发非腾讯系" },
        baijiahaoOriginalAck: { type: "boolean", required: false, desc: "百家号勾原创时必须 true" },
        provider: { type: '"openai" | "ollama" | "omlx" | "anthropic"', required: false, default: "openai" },
        model: { type: "string", required: false },
        generateImages: { type: "boolean", required: false, desc: "仅 topic 生成时有效，需配置 IMAGE_PROVIDER" },
        targetEngines: {
          type: "EngineId[]",
          required: false,
          desc: "目标 AI：doubao/yuanbao/deepseek/kimi/wenxin/qwen，生成时按信源亲和默认勾选平台",
        },
        questionIds: { type: "string[]", required: false, desc: "问题库 id，写入各站结构差异" },
        knowledgeIds: { type: "string[]", required: false, desc: "知识库 id，勾选 Markdown 注入生成" },
        coverBase64: { type: "string", required: false, desc: "jpeg/png/webp 的 base64 或 data URL；多数门户号没封面会校验失败" },
        coverMimeType: { type: "string", required: false, desc: "未带 data URL 前缀时使用，默认 image/jpeg" },
      },
      examples: {
        onePlatform: {
          confirm: true,
          platforms: "sohu",
          isAutoPublish: false,
          title: "标题至少四字以上",
          summary: "摘要写清楚文章在讲什么以及适用边界。",
          markdown: "正文……搜狐最少约 300 字。",
          coverBase64: "data:image/jpeg;base64,...",
        },
        allPlatformsFromTopic: {
          confirm: true,
          platforms: "all",
          isAutoPublish: false,
          topic: "主题",
          provider: "openai",
        },
        manyPlatforms: {
          confirm: true,
          platforms: ["sohu", "toutiao"],
          isAutoPublish: false,
          sessionId: "ses_xxx",
        },
      },
    },
    errors: [
      { status: 400, when: "缺 confirm / 内容三选一不满足 / 字数封面不合规 / 硬拦截" },
      { status: 404, when: "sessionId 或 job id 不存在" },
      { status: 503, when: "插件未连接" },
    ],
    compliance: [
      "AI/生图必须 aiDeclared=true",
      "禁止一次任务给全部已选平台勾原创",
      "头条 AI 稿不能勾原创",
      "头条勾首发只影响声明勾选；填表不会上线，不再因首发窗口拦截其他站填表",
      "企鹅独家不能同时投非腾讯系（公众号除外）",
      "百家号勾原创必须 baijiahaoOriginalAck=true",
    ],
    platforms: publishablePlatformIds().map((id) => {
      const rule = listRules().find((r) => r.id === id);
      return {
        id,
        label: PLATFORM_LABELS[id],
        title: rule?.title,
        body: rule?.body,
        summary: rule?.summary,
        cover: rule?.cover,
        categories: rule?.categories ?? [],
      };
    }),
  };
}

/** 产品路径永远不点发布。旧客户端传 true / mode=publish 会被忽略。 */
function resolveIsAutoPublish(input: AgentDispatchInput): boolean {
  if (input.isAutoPublish === true || input.mode === "publish") {
    logger.info("agent.ignore_auto_publish", {
      isAutoPublish: input.isAutoPublish,
      mode: input.mode,
    });
  }
  return false;
}

/**
 * 把 all / 单 id / id 列表收成可发平台。百科、官网不能进 all。
 */
export function resolveAgentPlatforms(selector: AgentDispatchInput["platforms"]): PlatformId[] {
  if (selector === "all") return publishablePlatformIds();
  const list = Array.isArray(selector) ? selector : [selector];
  const seen = new Set<PlatformId>();
  const out: PlatformId[] = [];
  for (const id of list) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function applySelection(session: TopicSession, ids: PlatformId[]): void {
  const allow = new Set(ids);
  for (const id of PLATFORM_IDS) {
    session.platforms[id].selected = allow.has(id);
  }
}

function applyCopy(session: TopicSession, ids: PlatformId[], input: AgentDispatchInput): void {
  const hasCopy = Boolean(input.title?.trim() || input.markdown?.trim() || input.summary?.trim());
  if (!hasCopy && input.aiDeclared === undefined && input.claimOriginal === undefined) return;

  if (input.title?.trim()) session.master.title = input.title.trim();
  if (input.markdown?.trim()) session.master.markdown = input.markdown.trim();
  if (input.summary !== undefined) session.master.summary = input.summary.trim();

  for (const id of ids) {
    if (!isPublishRule(id)) continue;
    const draft = session.platforms[id];
    if (input.title?.trim()) draft.title = input.title.trim();
    if (input.markdown?.trim()) draft.markdown = input.markdown.trim();
    if (input.summary !== undefined) draft.summary = input.summary.trim();
    if (input.category !== undefined) draft.category = input.category;
    if (input.tags) draft.tags = input.tags;
    if (input.aiDeclared !== undefined) draft.aiDeclared = input.aiDeclared;
    if (input.claimOriginal !== undefined) draft.claimOriginal = input.claimOriginal;
    if (input.claimFirstPublish !== undefined) draft.claimFirstPublish = input.claimFirstPublish;
    if (input.claimExclusive !== undefined) draft.claimExclusive = input.claimExclusive;
  }
}

function applyCover(session: TopicSession, ids: PlatformId[], input: AgentDispatchInput): void {
  const raw = input.coverBase64?.trim();
  if (!raw) return;
  const mime = input.coverMimeType?.trim() || guessMime(raw);
  const b64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    throw new AgentError(400, { error: "coverBase64 不是合法 base64" });
  }
  if (!buf.length) throw new AgentError(400, { error: "封面为空" });
  const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
  const asset = addUploadedAsset(session, `cover${ext}`, mime, buf);
  for (const id of ids) {
    if (!isPublishRule(id)) continue;
    session.platforms[id].coverAssetIds = [asset.id];
  }
  // 企鹅号封面必须来自正文图，否则校验只给警告、填表时也容易丢封面。
  if (ids.includes("qiehao") && !session.platforms.qiehao.markdown.includes(asset.id)) {
    session.platforms.qiehao.markdown = `![封面](/api/assets/${asset.filename})\n\n${session.platforms.qiehao.markdown}`;
  }
  logger.info("agent.cover_attached", { sessionId: session.id, assetId: asset.id, platforms: ids });
}

function guessMime(raw: string): string {
  if (raw.startsWith("data:")) {
    const match = raw.match(/^data:([^;]+);/);
    if (match?.[1]) return match[1];
  }
  return "image/jpeg";
}

class AgentError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? "agent error"));
    this.status = status;
    this.body = body;
  }
}

export function isAgentError(err: unknown): err is AgentError {
  return err instanceof AgentError;
}

/**
 * Agent 一次调用完成选平台 + 确认 + 执行。不另发 confirm token。
 */
export async function dispatchAgent(raw: unknown): Promise<{
  job: PublishJob;
  sessionId: string;
  platforms: PlatformId[];
  skipped?: Array<{ platform: PlatformId; reasons: string[] }>;
}> {
  const parsed = AgentDispatchSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("agent.dispatch_invalid", { issues: parsed.error.flatten() });
    throw new AgentError(400, { error: "请求不合法", issues: parsed.error.flatten() });
  }
  const input = parsed.data;

  if (!extensionConnected()) {
    logger.warn("agent.extension_missing");
    throw new AgentError(503, { error: "插件未连接。请在 chrome://extensions 加载 GeoPost 网关，角标为 ON 后再发。" });
  }

  const platforms = resolveAgentPlatforms(input.platforms);
  logger.info("agent.dispatch_start", {
    platforms,
    isAutoPublish: resolveIsAutoPublish(input),
    sessionId: input.sessionId,
    hasTopic: Boolean(input.topic?.trim()),
    hasCopy: Boolean(input.title || input.markdown),
  });

  let session: TopicSession | undefined;
  if (input.sessionId) {
    session = getSession(input.sessionId);
    if (!session) throw new AgentError(404, { error: "会话不存在" });
  } else if (input.topic?.trim()) {
    try {
      session = await generateSession(
        input.topic.trim(),
        input.provider ?? "openai",
        input.model,
        Boolean(input.generateImages),
        { targetEngines: input.targetEngines, questionIds: input.questionIds, knowledgeIds: input.knowledgeIds, platforms },
      );
    } catch (err) {
      logger.error("agent.generate_fail", { err: String(err) });
      throw new AgentError(400, { error: err instanceof Error ? err.message : String(err) });
    }
  } else if (input.title?.trim() && input.markdown?.trim()) {
    session = saveSession(createBlankSession(input.title.trim()));
  } else {
    throw new AgentError(400, {
      error: "需要内容：sessionId，或 topic（生成后再发），或同时给 title 与 markdown。",
    });
  }

  applySelection(session, platforms);
  applyCopy(session, platforms, input);
  applyCover(session, platforms, input);
  applyIsAutoPublish(session, resolveIsAutoPublish(input));
  saveSession(session);

  const plan = planPartialFill(session);
  if (plan.fillable.length === 0) {
    logger.warn("agent.blocked", { errors: plan.issues.errors, skipped: plan.skipped.length });
    throw new AgentError(400, { error: "没有可填入的平台", issues: plan.issues });
  }

  const needAck = plan.fillable.some((id) => id === "baijiahao" && session.platforms.baijiahao.claimOriginal);
  if (needAck && !input.baijiahaoOriginalAck) {
    throw new AgentError(400, { error: "勾选百家号原创必须二次确认。", needBaijiahaoAck: true, issues: plan.issues });
  }

  try {
    const job = await executeJob(session, plan.fillable);
    for (const r of job.results) {
      if (!r.ok || isChecklistPlatform(r.platform)) continue;
      session.platforms[r.platform] = clearFilledCopy(session.platforms[r.platform]);
    }
    saveSession(session);
    logger.info("agent.dispatch_done", {
      jobId: job.id,
      sessionId: session.id,
      ok: job.results.filter((r) => r.ok).length,
      skipped: plan.skipped.map((s) => s.platform),
    });
    return { job, sessionId: session.id, platforms: plan.fillable, skipped: plan.skipped };
  } catch (err) {
    const jobIssues = (err as { issues?: unknown }).issues;
    logger.error("agent.dispatch_fail", { err: String(err) });
    throw new AgentError(400, {
      error: err instanceof Error ? err.message : String(err),
      issues: jobIssues,
    });
  }
}
