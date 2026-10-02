import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createId, nowIso, PLATFORM_IDS, applyIsAutoPublish, isSaveDraftEditorPlatform, isChecklistPlatform, type AiProviderId, type DraftMode, type EngineId, type PlatformId, type PlatformUiPrefs, type TopicSession, type BrandProfile, type ContentQuestion, type KnowledgeDoc } from "@geopost/shared";
import { clearFilledCopy, engineAffinityTable, listRules, staticEditorCatalog } from "@geopost/rules";
import { agentCatalog, dispatchAgent, isAgentError } from "./agent.js";
import { extensionConnected, listAccounts, openEditor, pingExtension, probePlatformAccount } from "./bridge.js";
import { planPartialFill, validateSession } from "./compliance.js";
import { logger } from "./logger.js";
import { executeJob } from "./publisher.js";
import { addUploadedAsset, createBlankSession, generateSession, patchPlatform, reviewSelectedDrafts } from "./sessions.js";
import { consumePreview, getBrand, getEditorOptions, getJob, getSession, getSettings, knowledgeForGenerate, listKnowledge, listQuestions, listSessions, newPreviewToken, paths, putPreview, saveBrand, saveEditorCatalog, saveEditorCatalogs, saveKnowledge, saveQuestions, saveSession, saveSettings, takePreview } from "./store.js";

export function createApp() {
  const app = new Hono();
  app.use(
    "*",
    cors({
      // 本机 Agent / 控制台都允许；非 localhost 一律不放。
      origin: (origin) => {
        if (!origin) return "*";
        if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/api/health", async (c) => {
    const ext = extensionConnected();
    logger.debug("health", { ext });
    return c.json({
      ok: true,
      server: true,
      extension: ext,
      extensionPing: ext ? await pingExtension() : false,
    });
  });

  app.get("/api/platforms", (c) => {
    return c.json({ platforms: listRules(), affinities: engineAffinityTable() });
  });

  app.get("/api/accounts", async (c) => {
    try {
      const spawn = c.req.query("spawn") === "1";
      const { accounts, catalogs } = await listAccounts(spawn);
      if (catalogs.length) saveEditorCatalogs(catalogs);
      logger.info("accounts.probed", {
        spawn,
        loggedIn: accounts.filter((a) => a.loggedIn).map((a) => a.platform),
        catalogs: catalogs.map((x) => x.platform),
      });
      return c.json({ accounts, catalogs: spawn ? catalogs : undefined });
    } catch (err) {
      logger.warn("accounts.fail", { err: String(err) });
      return c.json({ accounts: [], error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  app.get("/api/editor-options", (c) => {
    const catalogs = getEditorOptions();
    return c.json({ catalogs });
  });

  /** 右侧平台按钮单独刷新：只探这一家，登录确认后拉分类/声明。 */
  app.post("/api/accounts/:platform/refresh", async (c) => {
    const platform = c.req.param("platform") as PlatformId;
    if (!(PLATFORM_IDS as readonly string[]).includes(platform)) {
      return c.json({ error: "未知平台" }, 400);
    }
    try {
      const { account, catalog } = await probePlatformAccount(platform, true);
      const saved = catalog ?? (account.loggedIn ? staticEditorCatalog(platform) : undefined);
      if (saved) saveEditorCatalog(saved);
      logger.info("account.refresh", {
        platform,
        loggedIn: account.loggedIn,
        source: saved?.source,
        categories: saved?.categories.length ?? 0,
        extraFields: (saved?.extraFields ?? []).map((f) => f.label),
      });
      return c.json({ account, catalog: saved });
    } catch (err) {
      logger.warn("account.refresh_fail", { platform, err: String(err) });
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
    }
  });

  app.get("/api/ai/models", async (c) => {
    const provider = (c.req.query("provider") ?? "omlx") as AiProviderId;
    try {
      const { listProviderModels } = await import("./ai.js");
      const listed = await listProviderModels(provider);
      logger.info("ai.models.listed", { provider, n: listed.models.length });
      return c.json(listed);
    } catch (err) {
      logger.warn("ai.models.fail", { provider, err: String(err) });
      return c.json({ models: [], defaultModel: "", error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/settings", (c) => {
    const settings = getSettings();
    logger.info("settings.loaded", { lastProvider: settings.lastProvider, lastModel: settings.lastModel });
    return c.json({ settings });
  });

  app.patch("/api/settings", async (c) => {
    const body = await c.req.json<{
      websiteUrl?: string;
      baikeUrl?: string;
      targetEngines?: EngineId[];
      lastProvider?: AiProviderId;
      lastModel?: string;
      platformPrefs?: Partial<Record<PlatformId, PlatformUiPrefs>>;
      lastPlatforms?: PlatformId[];
    }>();
    return c.json({ settings: saveSettings(body) });
  });

  app.get("/api/brand", (c) => c.json({ brand: getBrand() }));

  app.patch("/api/brand", async (c) => {
    const body = (await c.req.json()) as Partial<BrandProfile>;
    return c.json({ brand: saveBrand(body) });
  });

  app.get("/api/questions", (c) => c.json({ questions: listQuestions() }));

  app.put("/api/questions", async (c) => {
    const body = await c.req.json<{ questions?: ContentQuestion[] }>();
    const questions = Array.isArray(body.questions) ? body.questions : [];
    return c.json({ questions: saveQuestions(questions) });
  });

  app.post("/api/questions/generate", async (c) => {
    const body = await c.req.json<{
      topic?: string;
      provider?: AiProviderId;
      model?: string;
      knowledgeIds?: string[];
    }>();
    try {
      const knowledge = knowledgeForGenerate(body.knowledgeIds);
      logger.info("questions.generate_start", {
        topic: body.topic,
        knowledge: knowledge.length,
        knowledgeIds: knowledge.map((d) => d.id),
      });
      const { generateQuestionBank } = await import("./ai.js");
      const raw = await generateQuestionBank(
        getBrand(),
        body.topic,
        body.provider ?? "openai",
        body.model,
        knowledge,
      );
      const existing = listQuestions();
      const merged: ContentQuestion[] = [
        ...existing,
        ...raw.map((q) => ({
          id: createId("q"),
          intent: q.intent,
          text: q.text,
          selected: q.intent !== "brand",
          excludeFromVisibility: q.excludeFromVisibility,
        })),
      ];
      logger.info("questions.generated", { added: raw.length, knowledge: knowledge.length });
      return c.json({ questions: saveQuestions(merged) });
    } catch (err) {
      logger.error("questions.generate_fail", { err: String(err) });
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/knowledge", (c) => c.json({ knowledge: listKnowledge() }));

  app.put("/api/knowledge", async (c) => {
    const body = await c.req.json<{ knowledge?: KnowledgeDoc[] }>();
    const knowledge = Array.isArray(body.knowledge) ? body.knowledge : [];
    return c.json({ knowledge: saveKnowledge(knowledge) });
  });

  app.post("/api/accounts/:platform/login", async (c) => {
    const platform = c.req.param("platform") as PlatformId;
    const settings = getSettings();
    const url =
      platform === "website" ? settings.websiteUrl || undefined : platform === "baike" ? settings.baikeUrl || undefined : undefined;
    await openEditor(platform, url);
    return c.json({ ok: true });
  });

  app.get("/api/sessions", (c) => c.json({ sessions: listSessions() }));

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json<{
      topic?: string;
      provider?: AiProviderId;
      model?: string;
      generateImages?: boolean;
      blank?: boolean;
      questionIds?: string[];
      knowledgeIds?: string[];
      targetEngines?: EngineId[];
      platforms?: PlatformId[];
      source?: "topic" | "random_question";
    }>();
    if (body.blank || !body.topic?.trim()) {
      const session = saveSession(createBlankSession(body.topic ?? ""));
      return c.json({ session });
    }
    try {
      logger.info("generate.start", {
        source: body.source ?? "topic",
        topic: body.topic.trim(),
        platforms: body.platforms,
        questionIds: body.questionIds?.length ?? 0,
        knowledgeIds: body.knowledgeIds?.length ?? 0,
      });
      const session = await generateSession(
        body.topic.trim(),
        body.provider ?? "openai",
        body.model,
        Boolean(body.generateImages),
        {
          questionIds: body.questionIds,
          knowledgeIds: body.knowledgeIds,
          targetEngines: body.targetEngines,
          platforms: body.platforms,
          source: body.source,
        },
      );
      return c.json({ session });
    } catch (err) {
      logger.error("generate.fail", { err: String(err) });
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/sessions/:id", (c) => {
    const session = getSession(c.req.param("id"));
    if (!session) return c.json({ error: "会话不存在" }, 404);
    return c.json({ session });
  });

  app.patch("/api/sessions/:id", async (c) => {
    const session = getSession(c.req.param("id"));
    if (!session) return c.json({ error: "会话不存在" }, 404);
    const body = (await c.req.json()) as Partial<TopicSession>;
    if (body.master) session.master = { ...session.master, ...body.master };
    if (body.topic !== undefined) session.topic = body.topic;
    if (body.platforms) {
      for (const [key, value] of Object.entries(body.platforms)) {
        patchPlatform(session, key as keyof TopicSession["platforms"], value as unknown as Record<string, unknown>);
      }
    }
    return c.json({ session: saveSession(session) });
  });

  app.post("/api/sessions/:id/assets", async (c) => {
    const session = getSession(c.req.param("id"));
    if (!session) return c.json({ error: "会话不存在" }, 404);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) return c.json({ error: "缺少 file" }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    const asset = addUploadedAsset(session, file.name, file.type || "application/octet-stream", buf);
    saveSession(session);
    return c.json({ asset, session });
  });

  app.get("/api/assets/:filename", (c) => {
    const filename = c.req.param("filename");
    if (filename.includes("..") || filename.includes("/")) return c.json({ error: "bad" }, 400);
    try {
      const buf = readFileSync(join(paths.assetsDir, filename));
      return c.body(buf, 200, { "Content-Type": "application/octet-stream" });
    } catch {
      return c.json({ error: "not found" }, 404);
    }
  });

  app.post("/api/sessions/:id/validate", async (c) => {
    const session = getSession(c.req.param("id"));
    if (!session) return c.json({ error: "会话不存在" }, 404);
    const issues = validateSession(session);
    return c.json({ issues });
  });

  app.post("/api/sessions/:id/confirm", async (c) => {
    const session = getSession(c.req.param("id"));
    if (!session) return c.json({ error: "会话不存在" }, 404);
    let body: {
      platforms?: PlatformId[];
      mode?: DraftMode;
      isAutoPublish?: boolean;
      provider?: AiProviderId;
      model?: string;
    } = {};
    try {
      body = (await c.req.json()) as {
        platforms?: PlatformId[];
        mode?: DraftMode;
        isAutoPublish?: boolean;
        provider?: AiProviderId;
        model?: string;
      };
    } catch {
      body = {};
    }
    if (Array.isArray(body.platforms)) {
      const allow = new Set(body.platforms);
      for (const id of PLATFORM_IDS) {
        session.platforms[id].selected = allow.has(id);
      }
      logger.info("confirm.apply_platforms", { sessionId: session.id, platforms: body.platforms });
    }
    if (body.isAutoPublish === true || body.mode === "publish") {
      logger.info("confirm.ignore_auto_publish", { sessionId: session.id });
    }
    applyIsAutoPublish(session, false);
    logger.info("confirm.fill_editor_only", { sessionId: session.id });
    const reviews = await reviewSelectedDrafts(
      session,
      body.provider ?? session.provider ?? "openai",
      body.model || session.model,
    );
    saveSession(session);
    const plan = planPartialFill(session);
    const token = newPreviewToken();
    const skipMap = new Map(plan.skipped.map((s) => [s.platform, s.reasons.join("；")]));
    const preview = {
      token,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      issues: plan.issues,
      reviews,
      targets: Object.values(session.platforms)
        .filter((d) => d.selected)
        .map((d) => {
          const ready = plan.fillable.includes(d.platform);
          return {
            platform: d.platform,
            title: d.title,
            mode: d.mode,
            isAutoPublish: false,
            saveDraftThenEdit: isSaveDraftEditorPlatform(d.platform),
            aiDeclared: d.aiDeclared,
            claimOriginal: d.claimOriginal,
            claimFirstPublish: d.claimFirstPublish,
            claimExclusive: d.claimExclusive,
            ready,
            holdReason: ready ? undefined : (skipMap.get(d.platform) || (plan.subsetOk ? "本批暂缓" : "与其他站的原创/首发/独家规则冲突，暂缓")),
          };
        }),
    };
    logger.info("confirm.partial", {
      sessionId: session.id,
      fillable: plan.fillable,
      skipped: plan.skipped.map((s) => s.platform),
    });
    putPreview(session.id, preview);
    return c.json({ preview, session });
  });

  app.post("/api/publish", async (c) => {
    const body = await c.req.json<{ token: string; baijiahaoOriginalAck?: boolean; isAutoPublish?: boolean }>();
    const preview = takePreview(body.token);
    if (!preview) return c.json({ error: "确认已过期，请重新打开填入确认。" }, 400);
    const session = getSession(preview.sessionId);
    if (!session) return c.json({ error: "会话不存在" }, 404);
    if (body.isAutoPublish === true) {
      logger.info("publish.ignore_auto_publish", { sessionId: session.id });
    }
    applyIsAutoPublish(session, false);
    saveSession(session);
    const plan = planPartialFill(session);
    if (plan.fillable.length === 0) {
      return c.json({ error: "没有可填入的平台。缺封面等站请补齐后单独填入。", issues: plan.issues }, 400);
    }
    const needAck = plan.fillable.some((id) => id === "baijiahao" && session.platforms.baijiahao.claimOriginal);
    if (needAck && !body.baijiahaoOriginalAck) {
      return c.json({ error: "勾选百家号原创必须二次确认。", needBaijiahaoAck: true }, 400);
    }
    consumePreview(body.token);
    logger.info("publish.confirmed", {
      token: body.token,
      sessionId: session.id,
      fillable: plan.fillable,
      skipped: plan.skipped.map((s) => s.platform),
      at: nowIso(),
      confirmId: createId("ack"),
    });
    try {
      const job = await executeJob(session, plan.fillable);
      for (const r of job.results) {
        if (!r.ok || isChecklistPlatform(r.platform)) continue;
        session.platforms[r.platform] = clearFilledCopy(session.platforms[r.platform]);
        logger.info("publish.cleared", { sessionId: session.id, platform: r.platform });
      }
      saveSession(session);
      return c.json({ job, session });
    } catch (err) {
      const issues = (err as { issues?: unknown }).issues;
      return c.json({ error: err instanceof Error ? err.message : String(err), issues }, 400);
    }
  });

  app.get("/api/agent", (c) => c.json(agentCatalog()));

  app.post("/api/agent/dispatch", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON 无效" }, 400);
    }
    try {
      const result = await dispatchAgent(body);
      return c.json(result);
    } catch (err) {
      if (isAgentError(err)) {
        const status = err.status as 400 | 404 | 503;
        return c.json(err.body, status);
      }
      logger.error("agent.dispatch_unhandled", { err: String(err) });
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get("/api/jobs/:id", (c) => {
    const job = getJob(c.req.param("id"));
    if (!job) return c.json({ error: "任务不存在" }, 404);
    return c.json({ job });
  });

  return app;
}
