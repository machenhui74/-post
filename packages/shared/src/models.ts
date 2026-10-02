import type { PlatformId } from "./platforms.js";

export type { PlatformId };

export type DraftMode = "draft" | "publish";
export type AssetSource = "upload" | "ai";
/** 文案生成后端。omlx = 本机 Apple Silicon 的 oMLX（OpenAI 兼容）。 */
export const AI_PROVIDER_IDS = ["openai", "ollama", "omlx", "anthropic"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** 国内生成引擎：用来勾选发文站，不是监测采样器。 */
export const ENGINE_IDS = ["doubao", "yuanbao", "deepseek", "kimi", "wenxin", "qwen"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_LABELS: Record<EngineId, string> = {
  doubao: "豆包",
  yuanbao: "元宝",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  wenxin: "文心 / 百度 AI",
  qwen: "通义千问",
};

export type FactGrade = "A" | "B" | "C" | "D" | "E" | "unknown";

/** 单条可核验事实。unknown 禁止写进正文。 */
export interface BrandFact {
  id: string;
  label: string;
  value: string;
  aliases?: string[];
  evidence?: string;
  grade: FactGrade;
}

export interface BrandProfile {
  name: string;
  aliases: string[];
  domains: string[];
  products: string[];
  competitors: Array<{ name: string; aliases?: string[] }>;
  facts: BrandFact[];
  updatedAt: string;
}

export const QUESTION_INTENTS = [
  "recommend",
  "compare",
  "alternative",
  "price",
  "risk",
  "scenario",
  "brand",
] as const;
export type QuestionIntent = (typeof QUESTION_INTENTS)[number];

export const QUESTION_INTENT_LABELS: Record<QuestionIntent, string> = {
  recommend: "推荐",
  compare: "比较",
  alternative: "替代",
  price: "价格",
  risk: "风险",
  scenario: "场景",
  brand: "品牌核对",
};

/**
 * 内容规格用的买家问题。监测项目可复用同一批题；
 * brand 意图 excludeFromVisibility，生成时仍可约束口径。
 */
export interface ContentQuestion {
  id: string;
  intent: QuestionIntent;
  text: string;
  selected: boolean;
  excludeFromVisibility: boolean;
}

/**
 * 事实页知识库一篇。正文只存 Markdown；勾选后生成必须参考，不整篇照抄。
 */
export interface KnowledgeDoc {
  id: string;
  title: string;
  markdown: string;
  selected: boolean;
  updatedAt: string;
}

export type RewriteEditType = "Structure" | "Evidence" | "Safety" | "Style" | "Formatting";

export interface RewriteLogEntry {
  platform: PlatformId;
  editType: RewriteEditType;
  opPattern: string;
  validateOk: boolean;
  at: string;
}

export interface Asset {
  id: string;
  kind: "image";
  source: AssetSource;
  filename: string;
  mimeType: string;
  /** 本机可访问的相对路径，扩展转图时再读成 base64。 */
  relPath: string;
  prompt?: string;
  createdAt: string;
}

export interface MasterDraft {
  title: string;
  markdown: string;
  summary: string;
}

export interface PlatformDraft {
  platform: PlatformId;
  title: string;
  markdown: string;
  summary: string;
  coverAssetIds: string[];
  category: string;
  tags: string[];
  /** 扫到的「添加位置」等搜索框，键是官方标签原文。 */
  extras?: Record<string, string>;
  /** 位置类 extras 的快捷字段，和 extras['添加位置'] 同步。 */
  location?: string;
  /** 国法要求：生成合成内容必须声明。主题生成默认 true。 */
  aiDeclared: boolean;
  claimOriginal: boolean;
  claimFirstPublish: boolean;
  claimExclusive: boolean;
  mode: DraftMode;
  selected: boolean;
}

/** 控制台各站勾选/分类/声明，刷新和重新生成后接着用。 */
export interface PlatformUiPrefs {
  selected?: boolean;
  category?: string;
  location?: string;
  extras?: Record<string, string>;
  aiDeclared?: boolean;
  claimOriginal?: boolean;
  claimFirstPublish?: boolean;
  claimExclusive?: boolean;
}

export interface TopicSession {
  id: string;
  topic: string;
  provider: AiProviderId;
  model: string;
  master: MasterDraft;
  platforms: Record<PlatformId, PlatformDraft>;
  assets: Asset[];
  /** 生成时勾选的目标 AI，用来默认勾发文站。 */
  targetEngines?: EngineId[];
  questionIds?: string[];
  /** 本次生成参考过的知识库篇目。 */
  knowledgeIds?: string[];
  rewriteLog?: RewriteLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AccountInfo {
  platform: PlatformId;
  loggedIn: boolean;
  name?: string;
  avatar?: string;
  canPublish: boolean;
  /** 探测失败原因，便于卡片展示「去登录」。 */
  detail?: string;
}

/** 发文页上的分类/频道。id 用来填表，label 给控制台下拉。 */
export interface EditorCategoryOption {
  id: string;
  label: string;
  children?: EditorCategoryOption[];
}

export type EditorToggleKey = "aiDeclared" | "claimOriginal" | "claimFirstPublish" | "claimExclusive";

/** 发文页上分类/声明之外的表单项，靠扫描认出来，不按站点手写。 */
export type EditorExtraKind = "text" | "search" | "select" | "radio" | "checkbox";

export interface EditorExtraField {
  label: string;
  kind: EditorExtraKind;
  placeholder?: string;
  options?: string[];
  /** false：只让你看见，填入时不改官方默认（广告/合集/微头条）。 */
  fillable: boolean;
}

/** 官方页上的声明开关，文案跟站点走（头条「引用 AI」、知乎「包含 AI 辅助创作」）。 */
export interface EditorToggleOption {
  key: EditorToggleKey;
  label: string;
  visible: boolean;
}

/**
 * 某站发文可选项。登录确认后顺手拉；20s 轮询不更新。
 * static=规则兜底；api/dom=后台接口或已打开的编辑页。
 */
export interface EditorOptionCatalog {
  platform: PlatformId;
  accountName?: string;
  at: string;
  source: "static" | "api" | "dom" | "mixed";
  categories: EditorCategoryOption[];
  tags: string[];
  tagsVisible: boolean;
  toggles: EditorToggleOption[];
  summaryVisible: boolean;
  summaryLabel: string;
  /** 发文页扫到的额外表单项（位置/来源等），首页扫描通常是空的。 */
  extraFields?: EditorExtraField[];
  /** 由 extraFields 推导，兼容旧控制台。 */
  locationVisible?: boolean;
  locationLabel?: string;
}

/** 单站刷新：登录态 + 这份可选项。 */
export interface PlatformProbeResult {
  account: AccountInfo;
  catalog?: EditorOptionCatalog;
}

export interface ValidationIssue {
  code: string;
  message: string;
  platform?: PlatformId;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface PublishTarget {
  platform: PlatformId;
  mode: DraftMode;
  title: string;
  markdown: string;
  summary: string;
  html: string;
  /** 封面图，扩展侧塞进官方 file input。 */
  coverImages: Array<{ filename: string; mimeType: string; base64: string }>;
  /** 正文里出现过的素材，用于替换裂图 src。 */
  bodyImages: Array<{ filename: string; mimeType: string; base64: string }>;
  category: string;
  tags: string[];
  location?: string;
  extras?: Record<string, string>;
  aiDeclared: boolean;
  claimOriginal: boolean;
  claimFirstPublish: boolean;
  claimExclusive: boolean;
}

export interface TaskResult {
  platform: PlatformId;
  ok: boolean;
  message: string;
  editorOpened?: boolean;
  /** 填表后顺手扫到的发文项，写回目录缓存。 */
  catalog?: EditorOptionCatalog;
}

export interface PublishJob {
  id: string;
  sessionId: string;
  targets: PublishTarget[];
  results: TaskResult[];
  status: "pending" | "running" | "done";
  createdAt: string;
}

export interface GenerateRequest {
  topic: string;
  provider: AiProviderId;
  model?: string;
  generateImages?: boolean;
  questionIds?: string[];
  targetEngines?: EngineId[];
  /** 只生成这些站；不传则仍生成全部（兼容旧 Agent）。 */
  platforms?: PlatformId[];
}

export type ReviewAction = "pass" | "fixed" | "unfixed";

/** 填入前按该站发文标准审核的结果。 */
export interface PlatformReview {
  platform: PlatformId;
  action: ReviewAction;
  notes: string[];
}

export interface ConfirmPreview {
  token: string;
  expiresAt: string;
  issues: ValidationResult;
  reviews?: PlatformReview[];
  targets: Array<{
    platform: PlatformId;
    title: string;
    mode: DraftMode;
    /** 恒为 false。兼容旧前端字段，扩展永不点发布。 */
    isAutoPublish: boolean;
    saveDraftThenEdit: boolean;
    aiDeclared: boolean;
    claimOriginal: boolean;
    claimFirstPublish: boolean;
    claimExclusive: boolean;
    /** false=本批暂缓，稿留在详情，不挡其他站填入。 */
    ready: boolean;
    holdReason?: string;
  }>;
}

/**
 * 产品路径：永远只填表 / 存草稿，不点官方发布。
 * on 参数忽略，留给旧客户端兼容。
 */
export function applyIsAutoPublish(session: TopicSession, _on = false): void {
  for (const draft of Object.values(session.platforms)) {
    if (!draft.selected) continue;
    draft.mode = "draft";
  }
}
