import type {
  AccountInfo,
  AiProviderId,
  BrandProfile,
  ConfirmPreview,
  ContentQuestion,
  DraftMode,
  EditorOptionCatalog,
  EngineId,
  KnowledgeDoc,
  PlatformDraft,
  PlatformId,
  PlatformUiPrefs,
  PublishJob,
  TopicSession,
  ValidationResult,
} from "@geopost/shared";
import type { PlatformRule } from "@geopost/rules";

const base = "";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export const api = {
  health: () => json<{ ok: boolean; server: boolean; extension: boolean; extensionPing: boolean }>("/api/health"),
  platforms: () => json<{ platforms: PlatformRule[]; affinities: Record<EngineId, PlatformId[]> }>("/api/platforms"),
  accounts: (spawn = false) =>
    json<{ accounts: AccountInfo[]; catalogs?: EditorOptionCatalog[]; error?: string }>(`/api/accounts${spawn ? "?spawn=1" : ""}`),
  /** 缓存的各站发文可选项（登录刷新后写入）。 */
  editorOptions: () => json<{ catalogs: Partial<Record<PlatformId, EditorOptionCatalog>> }>("/api/editor-options"),
  /** 右侧平台按钮单独刷新：只探这一家。 */
  refreshAccount: (platform: PlatformId) =>
    json<{ account: AccountInfo; catalog?: EditorOptionCatalog }>(`/api/accounts/${platform}/refresh`, { method: "POST" }),
  openLogin: (platform: PlatformId) => json(`/api/accounts/${platform}/login`, { method: "POST" }),
  createBlank: () => json<{ session: TopicSession }>("/api/sessions", { method: "POST", body: JSON.stringify({ blank: true }) }),
  generate: (body: {
    topic: string;
    provider: AiProviderId;
    model?: string;
    generateImages?: boolean;
    questionIds?: string[];
    knowledgeIds?: string[];
    targetEngines?: EngineId[];
    platforms?: PlatformId[];
    source?: "topic" | "random_question";
  }) => json<{ session: TopicSession }>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  getSession: (id: string) => json<{ session: TopicSession }>(`/api/sessions/${id}`),
  patchSession: (id: string, body: Partial<TopicSession> & { platforms?: Partial<Record<PlatformId, Partial<PlatformDraft>>> }) =>
    json<{ session: TopicSession }>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  upload: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/sessions/${id}/assets`, { method: "POST", body: form });
    const data = (await res.json()) as { session: TopicSession; error?: string };
    if (!res.ok) throw new Error(data.error ?? "上传失败");
    return data;
  },
  validate: (id: string) => json<{ issues: ValidationResult }>(`/api/sessions/${id}/validate`, { method: "POST" }),
  confirm: (
    id: string,
    body?: {
      platforms?: PlatformId[];
      mode?: DraftMode;
      isAutoPublish?: boolean;
      provider?: AiProviderId;
      model?: string;
    },
  ) =>
    json<{ preview: ConfirmPreview; session: TopicSession }>(`/api/sessions/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify(body ?? { isAutoPublish: false }),
    }),
  publish: (token: string, baijiahaoOriginalAck?: boolean, isAutoPublish = false) =>
    json<{ job: PublishJob; session: TopicSession }>("/api/publish", {
      method: "POST",
      body: JSON.stringify({ token, baijiahaoOriginalAck, isAutoPublish }),
    }),
  settings: () =>
    json<{
      settings: {
        websiteUrl: string;
        baikeUrl: string;
        toutiaoFirstPublishUntil?: string;
        targetEngines?: EngineId[];
        lastProvider?: AiProviderId;
        lastModel?: string;
        platformPrefs?: Partial<Record<PlatformId, PlatformUiPrefs>>;
        lastPlatforms?: PlatformId[];
      };
    }>("/api/settings"),
  saveSettings: (body: {
    websiteUrl?: string;
    baikeUrl?: string;
    targetEngines?: EngineId[];
    lastProvider?: AiProviderId;
    lastModel?: string;
    platformPrefs?: Partial<Record<PlatformId, PlatformUiPrefs>>;
    lastPlatforms?: PlatformId[];
  }) =>
    json<{
      settings: {
        websiteUrl: string;
        baikeUrl: string;
        toutiaoFirstPublishUntil?: string;
        targetEngines?: EngineId[];
        lastProvider?: AiProviderId;
        lastModel?: string;
        platformPrefs?: Partial<Record<PlatformId, PlatformUiPrefs>>;
        lastPlatforms?: PlatformId[];
      };
    }>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  brand: () => json<{ brand: BrandProfile }>("/api/brand"),
  saveBrand: (body: Partial<BrandProfile>) =>
    json<{ brand: BrandProfile }>("/api/brand", { method: "PATCH", body: JSON.stringify(body) }),
  questions: () => json<{ questions: ContentQuestion[] }>("/api/questions"),
  saveQuestions: (questions: ContentQuestion[]) =>
    json<{ questions: ContentQuestion[] }>("/api/questions", { method: "PUT", body: JSON.stringify({ questions }) }),
  generateQuestions: (body: { topic?: string; provider: AiProviderId; model?: string; knowledgeIds?: string[] }) =>
    json<{ questions: ContentQuestion[] }>("/api/questions/generate", { method: "POST", body: JSON.stringify(body) }),
  knowledge: () => json<{ knowledge: KnowledgeDoc[] }>("/api/knowledge"),
  saveKnowledge: (knowledge: KnowledgeDoc[]) =>
    json<{ knowledge: KnowledgeDoc[] }>("/api/knowledge", { method: "PUT", body: JSON.stringify({ knowledge }) }),
  listModels: (provider: AiProviderId) =>
    json<{ models: string[]; defaultModel: string }>(`/api/ai/models?provider=${encodeURIComponent(provider)}`),
};

export function assetUrl(filename: string): string {
  return `/api/assets/${filename}`;
}
