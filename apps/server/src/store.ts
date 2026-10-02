import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_PROVIDER_IDS,
  PLATFORM_IDS,
  createId,
  nowIso,
  type AiProviderId,
  type BrandProfile,
  type ConfirmPreview,
  type ContentQuestion,
  type EditorOptionCatalog,
  type EngineId,
  type KnowledgeDoc,
  type PlatformId,
  type PlatformUiPrefs,
  type PublishJob,
  type RewriteLogEntry,
  type TopicSession,
} from "@geopost/shared";
import { defaultDrafts } from "@geopost/rules";
import { logger } from "./logger.js";

function hydrateSession(session: TopicSession): TopicSession {
  session.platforms = { ...defaultDrafts(), ...session.platforms };
  return session;
}

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../../../.data");
mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, "assets"), { recursive: true });

const sessionFile = join(dataDir, "sessions.json");
const jobFile = join(dataDir, "jobs.json");
const settingsFile = join(dataDir, "settings.json");
const brandFile = join(dataDir, "brand.json");
const questionsFile = join(dataDir, "questions.json");
const knowledgeFile = join(dataDir, "knowledge.json");
const rewriteLogFile = join(dataDir, "rewrite-log.json");
const editorOptionsFile = join(dataDir, "editor-options.json");

export interface GeoSettings {
  /** 企业官网文章或首页，checklist「去维护」用。 */
  websiteUrl: string;
  /** 百科词条或用户中心链接。 */
  baikeUrl: string;
  /** 头条「首发」成功发布后的 72h 窗口截止。 */
  toutiaoFirstPublishUntil?: string;
  /** 勾选目标 AI 后，生成时默认勾对应信源站。 */
  targetEngines?: EngineId[];
  /** 控制台「模型」下拉上次选的后端，刷新后接着用。 */
  lastProvider?: AiProviderId;
  /** 控制台上次填的模型名（oMLX 下拉或手输）。 */
  lastModel?: string;
  /** 各站分类/声明/是否参与，刷新和重新生成后接着用。 */
  platformPrefs?: Partial<Record<PlatformId, PlatformUiPrefs>>;
  /** 右侧平台勾选的完整列表；有此字段就按它恢复，不再用各站 defaultSelected。 */
  lastPlatforms?: PlatformId[];
}

const defaultSettings: GeoSettings = { websiteUrl: "", baikeUrl: "https://baike.baidu.com/", targetEngines: [] };

const FIRST_PUBLISH_MS = 72 * 60 * 60 * 1000;

/** 真正把头条以「发布」且勾首发投出去之后，才锁窗口。 */
export function markToutiaoFirstPublish(): GeoSettings {
  const until = new Date(Date.now() + FIRST_PUBLISH_MS).toISOString();
  logger.info("toutiao.first_window", { until });
  return saveSettings({ toutiaoFirstPublishUntil: until });
}

interface DiskState {
  sessions: TopicSession[];
  jobs: PublishJob[];
}

function load(): DiskState {
  try {
    const sessions = JSON.parse(readFileSync(sessionFile, "utf8")) as TopicSession[];
    const jobs = JSON.parse(readFileSync(jobFile, "utf8")) as PublishJob[];
    return { sessions, jobs };
  } catch {
    return { sessions: [], jobs: [] };
  }
}

function persist(state: DiskState): void {
  writeFileSync(sessionFile, JSON.stringify(state.sessions, null, 2));
  writeFileSync(jobFile, JSON.stringify(state.jobs, null, 2));
}

const mem = load();
const previews = new Map<string, ConfirmPreview & { sessionId: string }>();

export const paths = {
  dataDir,
  assetsDir: join(dataDir, "assets"),
};

export function listSessions(): TopicSession[] {
  return mem.sessions.map(hydrateSession);
}

export function getSession(id: string): TopicSession | undefined {
  const session = mem.sessions.find((s) => s.id === id);
  return session ? hydrateSession(session) : undefined;
}

export function saveSession(session: TopicSession): TopicSession {
  session.updatedAt = nowIso();
  const idx = mem.sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) mem.sessions[idx] = session;
  else mem.sessions.unshift(session);
  persist(mem);
  logger.info("session.saved", { id: session.id, topic: session.topic });
  return session;
}

export function saveJob(job: PublishJob): PublishJob {
  const idx = mem.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) mem.jobs[idx] = job;
  else mem.jobs.unshift(job);
  persist(mem);
  logger.info("job.saved", { id: job.id, status: job.status });
  return job;
}

export function getJob(id: string): PublishJob | undefined {
  return mem.jobs.find((j) => j.id === id);
}

export function putPreview(sessionId: string, preview: ConfirmPreview): void {
  previews.set(preview.token, { ...preview, sessionId });
  logger.info("preview.issued", { token: preview.token, sessionId });
}

export function takePreview(token: string): (ConfirmPreview & { sessionId: string }) | undefined {
  const item = previews.get(token);
  if (!item) return undefined;
  if (Date.parse(item.expiresAt) < Date.now()) {
    previews.delete(token);
    logger.warn("preview.expired", { token });
    return undefined;
  }
  return item;
}

export function consumePreview(token: string): void {
  previews.delete(token);
}

export function newPreviewToken(): string {
  return createId("cfm");
}

export function getSettings(): GeoSettings {
  try {
    const raw = { ...defaultSettings, ...(JSON.parse(readFileSync(settingsFile, "utf8")) as GeoSettings) };
    // 旧数据或手改文件可能写出未知 provider，丢掉以免前端 select 卡死。
    if (raw.lastProvider && !AI_PROVIDER_IDS.includes(raw.lastProvider)) {
      logger.warn("settings.provider_unknown", { lastProvider: raw.lastProvider });
      raw.lastProvider = undefined;
    }
    if (Array.isArray(raw.lastPlatforms)) {
      raw.lastPlatforms = raw.lastPlatforms.filter((id): id is PlatformId =>
        (PLATFORM_IDS as readonly string[]).includes(id),
      );
    }
    return raw;
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(patch: Partial<GeoSettings>): GeoSettings {
  const cur = getSettings();
  const next: GeoSettings = { ...cur };
  for (const [key, value] of Object.entries(patch) as Array<[keyof GeoSettings, GeoSettings[keyof GeoSettings]]>) {
    if (value === undefined || key === "platformPrefs") continue;
    (next[key] as GeoSettings[keyof GeoSettings]) = value;
  }
  if (patch.platformPrefs) {
    const merged: Partial<Record<PlatformId, PlatformUiPrefs>> = { ...cur.platformPrefs };
    for (const [id, prefs] of Object.entries(patch.platformPrefs)) {
      if (!prefs) continue;
      const key = id as PlatformId;
      merged[key] = { ...merged[key], ...prefs };
    }
    next.platformPrefs = merged;
  }
  writeFileSync(settingsFile, JSON.stringify(next, null, 2));
  logger.info("settings.saved", {
    websiteUrl: next.websiteUrl,
    baikeUrl: next.baikeUrl,
    engines: next.targetEngines,
    lastProvider: next.lastProvider,
    lastModel: next.lastModel,
    lastPlatforms: next.lastPlatforms,
    platformPrefs: Object.keys(next.platformPrefs ?? {}),
  });
  return next;
}

export function emptyBrand(): BrandProfile {
  return {
    name: "",
    aliases: [],
    domains: [],
    products: [],
    competitors: [],
    facts: [],
    updatedAt: nowIso(),
  };
}

export function getBrand(): BrandProfile {
  try {
    return { ...emptyBrand(), ...(JSON.parse(readFileSync(brandFile, "utf8")) as BrandProfile) };
  } catch {
    return emptyBrand();
  }
}

export function saveBrand(patch: Partial<BrandProfile>): BrandProfile {
  const prev = getBrand();
  const next: BrandProfile = {
    ...prev,
    ...patch,
    aliases: patch.aliases ?? prev.aliases,
    domains: patch.domains ?? prev.domains,
    products: patch.products ?? prev.products,
    competitors: patch.competitors ?? prev.competitors,
    facts: patch.facts ?? prev.facts,
    updatedAt: nowIso(),
  };
  writeFileSync(brandFile, JSON.stringify(next, null, 2));
  logger.info("brand.save", { name: next.name, facts: next.facts.length });
  return next;
}

export function listQuestions(): ContentQuestion[] {
  try {
    return JSON.parse(readFileSync(questionsFile, "utf8")) as ContentQuestion[];
  } catch {
    return [];
  }
}

export function saveQuestions(questions: ContentQuestion[]): ContentQuestion[] {
  writeFileSync(questionsFile, JSON.stringify(questions, null, 2));
  logger.info("questions.save", { n: questions.length, selected: questions.filter((q) => q.selected).length });
  return questions;
}

export function questionsByIds(ids: string[]): ContentQuestion[] {
  const allow = new Set(ids);
  return listQuestions().filter((q) => allow.has(q.id));
}

function normalizeKnowledge(raw: unknown): KnowledgeDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  return {
    id: o.id,
    title: typeof o.title === "string" ? o.title : "",
    markdown: typeof o.markdown === "string" ? o.markdown : "",
    selected: Boolean(o.selected),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : nowIso(),
  };
}

export function listKnowledge(): KnowledgeDoc[] {
  try {
    const raw = JSON.parse(readFileSync(knowledgeFile, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeKnowledge).filter((d): d is KnowledgeDoc => Boolean(d));
  } catch {
    return [];
  }
}

export function saveKnowledge(docs: KnowledgeDoc[]): KnowledgeDoc[] {
  const next = docs
    .map(normalizeKnowledge)
    .filter((d): d is KnowledgeDoc => Boolean(d))
    .map((d) => ({ ...d, updatedAt: nowIso() }));
  writeFileSync(knowledgeFile, JSON.stringify(next, null, 2));
  logger.info("knowledge.save", { n: next.length, selected: next.filter((d) => d.selected).length });
  return next;
}

/**
 * 按 id 取篇目并视为本次已勾选，供 Prompt 注入。
 * ids 为空则退回磁盘上当前勾选的篇。
 */
export function knowledgeForGenerate(ids?: string[]): KnowledgeDoc[] {
  if (ids && ids.length > 0) {
    const allow = new Set(ids);
    return listKnowledge()
      .filter((d) => allow.has(d.id))
      .map((d) => ({ ...d, selected: true }));
  }
  if (ids && ids.length === 0) return [];
  return listKnowledge().filter((d) => d.selected);
}

export function appendRewriteLog(entry: RewriteLogEntry): void {
  let rows: RewriteLogEntry[] = [];
  try {
    rows = JSON.parse(readFileSync(rewriteLogFile, "utf8")) as RewriteLogEntry[];
  } catch {
    rows = [];
  }
  rows.unshift(entry);
  writeFileSync(rewriteLogFile, JSON.stringify(rows.slice(0, 200), null, 2));
  logger.info("rewrite.logged", {
    platform: entry.platform,
    op: entry.opPattern,
    ok: entry.validateOk,
  });
}

export function getEditorOptions(): Partial<Record<PlatformId, EditorOptionCatalog>> {
  try {
    const raw = JSON.parse(readFileSync(editorOptionsFile, "utf8")) as Partial<Record<PlatformId, EditorOptionCatalog>>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function getEditorCatalog(id: PlatformId): EditorOptionCatalog | undefined {
  return getEditorOptions()[id];
}

  /** 登录刷新扫到的分类/声明/发文页额外项缓存；按站覆盖，不丢其它站。 */
export function saveEditorCatalog(catalog: EditorOptionCatalog): EditorOptionCatalog {
  const all = getEditorOptions();
  const prev = all[catalog.platform];
  // 这次只扫到首页时 extraFields 为空，不能把上次发文页扫到的位置等项冲掉。
  if (prev?.extraFields?.length && !catalog.extraFields?.length) {
    catalog = { ...catalog, extraFields: prev.extraFields, locationVisible: prev.locationVisible, locationLabel: prev.locationLabel };
  }
  all[catalog.platform] = catalog;
  writeFileSync(editorOptionsFile, JSON.stringify(all, null, 2));
  logger.info("editor_options.saved", {
    platform: catalog.platform,
    source: catalog.source,
    categories: catalog.categories.length,
    extraFields: (catalog.extraFields ?? []).map((f) => f.label),
    account: catalog.accountName,
  });
  return catalog;
}

export function saveEditorCatalogs(catalogs: EditorOptionCatalog[]): Partial<Record<PlatformId, EditorOptionCatalog>> {
  if (!catalogs.length) return getEditorOptions();
  const all = getEditorOptions();
  for (const catalog of catalogs) all[catalog.platform] = catalog;
  writeFileSync(editorOptionsFile, JSON.stringify(all, null, 2));
  logger.info("editor_options.batch_saved", {
    n: catalogs.length,
    platforms: catalogs.map((c) => c.platform),
  });
  return all;
}
