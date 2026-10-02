import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createId, nowIso, type AiProviderId, type Asset, type BrandProfile, type ContentQuestion, type KnowledgeDoc } from "@geopost/shared";
import {
  buildGeneratePrompt,
  buildQuestionBankPrompt,
  buildRewritePrompt,
  buildReviewFixPrompt,
  SYSTEM_GUARD,
  type GeneratePromptInput,
} from "@geopost/rules";
import { logger } from "./logger.js";
import { paths } from "./store.js";

export interface ChatResult {
  text: string;
  model: string;
}

/** ~/.omlx/settings.json 只取连接所需字段，不把 key 打进日志。 */
interface OmlxSettingsFile {
  server?: { host?: string; port?: number };
  auth?: { api_key?: string; skip_api_key_verification?: boolean };
}

interface OmlxModelSettingsFile {
  models?: Record<string, { is_default?: boolean }>;
}

function omlxHome(): string {
  return join(homedir(), ".omlx");
}

function readOmlxSettings(): OmlxSettingsFile | null {
  const file = join(omlxHome(), "settings.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as OmlxSettingsFile;
  } catch (err) {
    logger.warn("ai.omlx.settings_unreadable", { err: String(err) });
    return null;
  }
}

/**
 * 管理面板里标了默认的模型优先；没有就按目录名。
 * 这样 UI 留空时也能打到用户正在用的那颗。
 */
function readOmlxDefaultModel(): string {
  const file = join(omlxHome(), "model_settings.json");
  if (existsSync(file)) {
    try {
      const json = JSON.parse(readFileSync(file, "utf8")) as OmlxModelSettingsFile;
      const hit = Object.entries(json.models ?? {}).find(([, v]) => v?.is_default);
      if (hit?.[0]) return hit[0];
    } catch (err) {
      logger.warn("ai.omlx.model_settings_unreadable", { err: String(err) });
    }
  }
  const dir = join(omlxHome(), "models");
  if (!existsSync(dir)) return "";
  try {
    return readdirSync(dir, { withFileTypes: true }).find((e) => e.isDirectory())?.name ?? "";
  } catch (err) {
    logger.warn("ai.omlx.models_dir_unreadable", { err: String(err) });
    return "";
  }
}

function listOmlxModelsFromDisk(): string[] {
  const dir = join(omlxHome(), "models");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    logger.warn("ai.omlx.models_dir_unreadable", { err: String(err) });
    return [];
  }
}

function openaiCompatBase(provider: AiProviderId): { url: string; key: string; model: string } {
  if (provider === "ollama") {
    return {
      url: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
      key: "ollama",
      model: process.env.OLLAMA_MODEL ?? "qwen2.5",
    };
  }
  if (provider === "omlx") {
    const local = readOmlxSettings();
    const port = local?.server?.port ?? 8000;
    const envKey = process.env.OMLX_API_KEY?.trim() ?? "";
    const fileKey = local?.auth?.api_key?.trim() ?? "";
    const skipAuth = Boolean(local?.auth?.skip_api_key_verification);
    const key = envKey || fileKey || (skipAuth ? "omlx" : "");
    const model = process.env.OMLX_MODEL?.trim() || readOmlxDefaultModel();
    logger.info("ai.omlx.config", {
      url: process.env.OMLX_BASE_URL ?? `http://127.0.0.1:${port}/v1`,
      hasKey: Boolean(key),
      keySource: envKey ? "env" : fileKey ? "omlx-settings" : skipAuth ? "skipped" : "none",
      defaultModel: model || "(none)",
    });
    return {
      url: process.env.OMLX_BASE_URL ?? `http://127.0.0.1:${port}/v1`,
      key,
      model,
    };
  }
  return {
    url: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    key: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

/**
 * 控制台模型下拉用。优先打 oMLX /v1/models，失败再读本机模型目录。
 */
export async function listProviderModels(
  provider: AiProviderId,
): Promise<{ models: string[]; defaultModel: string }> {
  if (provider !== "omlx") {
    logger.debug("ai.models.skip", { provider });
    return { models: [], defaultModel: "" };
  }
  const cfg = openaiCompatBase("omlx");
  const fallback = listOmlxModelsFromDisk();
  const defaultModel = cfg.model || fallback[0] || "";
  if (!cfg.key) {
    logger.warn("ai.omlx.models.no_key", { disk: fallback.length });
    return { models: fallback, defaultModel };
  }
  try {
    logger.info("ai.omlx.models.fetch", { url: cfg.url });
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
    if (!res.ok) {
      logger.warn("ai.omlx.models.http_error", { status: res.status });
      return { models: fallback, defaultModel };
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    logger.info("ai.omlx.models.ok", { n: models.length, defaultModel });
    return { models: models.length ? models : fallback, defaultModel };
  } catch (err) {
    logger.warn("ai.omlx.models.fail", { err: String(err), disk: fallback.length });
    return { models: fallback, defaultModel };
  }
}

function messageText(message: { content?: unknown; reasoning_content?: unknown } | undefined): string {
  const content = message?.content;
  const asString = typeof content === "string" ? content : "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  // thinking 模型有时把正文放 reasoning_content，JSON 抽取需要拼起来。
  return [asString, reasoning].filter(Boolean).join("\n");
}

async function chatOpenAiCompat(provider: AiProviderId, model: string | undefined, user: string): Promise<ChatResult> {
  const cfg = openaiCompatBase(provider);
  const usedModel = model || cfg.model;
  if (provider === "openai" && !cfg.key) {
    throw new Error("未配置 OPENAI_API_KEY。可改用 ollama / omlx 或填写 .env");
  }
  if (provider === "omlx" && !cfg.key) {
    throw new Error("未配置 OMLX_API_KEY。可在 .env 填写，或确认 ~/.omlx/settings.json 已有 api_key");
  }
  if (provider === "omlx" && !usedModel) {
    throw new Error("未指定 oMLX 模型。请在下拉框选择，或设置 OMLX_MODEL");
  }
  logger.info("ai.chat.start", { provider, model: usedModel, url: cfg.url });
  const payload: Record<string, unknown> = {
    model: usedModel,
    temperature: 0.6,
    messages: [
      { role: "system", content: SYSTEM_GUARD },
      { role: "user", content: user },
    ],
  };
  if (provider === "omlx") {
    // 长文 JSON 包需要足够 token；关掉 thinking，避免推理括号破坏 extractJson。
    payload.max_tokens = Number(process.env.OMLX_MAX_TOKENS ?? 8192);
    payload.chat_template_kwargs = { enable_thinking: false };
  }
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error("ai.chat.http_error", { status: res.status, body: body.slice(0, 500) });
    throw new Error(`模型请求失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
  };
  const text = messageText(json.choices?.[0]?.message);
  logger.info("ai.chat.ok", { provider, chars: text.length });
  return { text, model: usedModel };
}

async function chatAnthropic(model: string | undefined, user: string): Promise<ChatResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("未配置 ANTHROPIC_API_KEY");
  const used = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  logger.info("ai.claude.start", { model: used });
  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: used,
    max_tokens: 8000,
    system: SYSTEM_GUARD,
    messages: [{ role: "user", content: user }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  logger.info("ai.claude.ok", { chars: text.length });
  return { text, model: used };
}

export async function chat(provider: AiProviderId, model: string | undefined, user: string): Promise<ChatResult> {
  if (provider === "anthropic") return chatAnthropic(model, user);
  return chatOpenAiCompat(provider, model, user);
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("模型没有返回 JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function generateBundle(ctx: GeneratePromptInput, provider: AiProviderId, model?: string) {
  logger.info("ai.bundle.start", {
    topic: ctx.topic,
    facts: ctx.brand?.facts.length ?? 0,
    questions: ctx.questions?.length ?? 0,
    knowledge: ctx.knowledge?.filter((d) => d.selected).length ?? 0,
    engines: ctx.engines,
    platforms: ctx.platforms,
  });
  const { text, model: used } = await chat(provider, model, buildGeneratePrompt(ctx));
  const parsed = extractJson(text) as {
    master?: { title?: string; summary?: string; markdown?: string };
    imagePrompts?: string[];
    platforms?: Record<
      string,
      { title?: string; summary?: string; markdown?: string; category?: string; tags?: string[] }
    >;
  };
  logger.info("ai.bundle.parsed", { topic: ctx.topic, hasMaster: Boolean(parsed.master) });
  return { parsed, model: used };
}

export async function generateQuestionBank(
  brand: BrandProfile,
  topic: string | undefined,
  provider: AiProviderId,
  model?: string,
  knowledge?: KnowledgeDoc[],
): Promise<Array<{ intent: ContentQuestion["intent"]; text: string; excludeFromVisibility: boolean }>> {
  logger.info("ai.questions.start", { brand: brand.name, topic, knowledge: knowledge?.length ?? 0 });
  const { text } = await chat(provider, model, buildQuestionBankPrompt(brand, topic, knowledge));
  const parsed = extractJson(text) as {
    questions?: Array<{ intent?: string; text?: string; excludeFromVisibility?: boolean }>;
  };
  const allowed = new Set(["recommend", "compare", "alternative", "price", "risk", "scenario", "brand"]);
  const out = (parsed.questions ?? [])
    .filter((q) => q.text?.trim() && allowed.has(q.intent ?? ""))
    .map((q) => ({
      intent: q.intent as ContentQuestion["intent"],
      text: q.text!.trim(),
      excludeFromVisibility: q.intent === "brand" ? true : Boolean(q.excludeFromVisibility),
    }));
  logger.info("ai.questions.ok", { n: out.length });
  return out;
}

export async function rewritePlatformDraft(
  input: Parameters<typeof buildRewritePrompt>[0],
  provider: AiProviderId,
  model?: string,
): Promise<{ title: string; summary: string; markdown: string } | null> {
  logger.info("ai.rewrite.start", { platform: input.platform, missing: input.missing });
  try {
    const { text } = await chat(provider, model, buildRewritePrompt(input));
    const parsed = extractJson(text) as { title?: string; summary?: string; markdown?: string };
    if (!parsed.markdown?.trim()) return null;
    logger.info("ai.rewrite.ok", { platform: input.platform, chars: parsed.markdown.length });
    return {
      title: parsed.title?.trim() || input.title,
      summary: parsed.summary?.trim() || input.summary,
      markdown: parsed.markdown.trim(),
    };
  } catch (err) {
    logger.warn("ai.rewrite.fail", { platform: input.platform, err: String(err) });
    return null;
  }
}

export interface ReviewFixResult {
  pass: boolean;
  notes: string[];
  unfixed: string[];
  title: string;
  summary: string;
  markdown: string;
}

/** 按该站发文标准审核；不合适则直接改写到可填表。失败返回 null 不覆盖原文。 */
export async function reviewAndFixPlatformDraft(
  input: Parameters<typeof buildReviewFixPrompt>[0],
  provider: AiProviderId,
  model?: string,
): Promise<ReviewFixResult | null> {
  logger.info("ai.review.start", { platform: input.platform, issues: input.issues.length });
  try {
    const { text } = await chat(provider, model, buildReviewFixPrompt(input));
    const parsed = extractJson(text) as {
      pass?: boolean;
      notes?: unknown;
      unfixed?: unknown;
      title?: string;
      summary?: string;
      markdown?: string;
    };
    const markdown = parsed.markdown?.trim() || "";
    if (!markdown) {
      logger.warn("ai.review.empty", { platform: input.platform });
      return null;
    }
    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(String).filter(Boolean) : [];
    const unfixed = Array.isArray(parsed.unfixed) ? parsed.unfixed.map(String).filter(Boolean) : [];
    logger.info("ai.review.ok", { platform: input.platform, pass: Boolean(parsed.pass), notes: notes.length });
    return {
      pass: Boolean(parsed.pass),
      notes,
      unfixed,
      title: parsed.title?.trim() || input.title,
      summary: parsed.summary?.trim() || input.summary,
      markdown,
    };
  } catch (err) {
    logger.warn("ai.review.fail", { platform: input.platform, err: String(err) });
    return null;
  }
}

export async function generateImage(prompt: string): Promise<Asset | null> {
  const provider = process.env.IMAGE_PROVIDER ?? "none";
  if (provider === "none") {
    logger.info("ai.image.skipped", { reason: "IMAGE_PROVIDER=none" });
    return null;
  }
  const cfg = openaiCompatBase("openai");
  if (!cfg.key) {
    logger.warn("ai.image.no_key");
    return null;
  }
  logger.info("ai.image.start", { prompt: prompt.slice(0, 80) });
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify({
      model: process.env.IMAGE_MODEL ?? "dall-e-3",
      prompt,
      n: 1,
      size: "1792x1024",
      response_format: "b64_json",
    }),
  });
  if (!res.ok) {
    logger.error("ai.image.fail", { status: res.status, body: (await res.text()).slice(0, 300) });
    return null;
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) return null;
  const id = createId("img");
  const filename = `${id}.png`;
  writeFileSync(join(paths.assetsDir, filename), Buffer.from(b64, "base64"));
  const asset: Asset = {
    id,
    kind: "image",
    source: "ai",
    filename,
    mimeType: "image/png",
    relPath: `assets/${filename}`,
    prompt,
    createdAt: nowIso(),
  };
  logger.info("ai.image.saved", { id, filename });
  return asset;
}
