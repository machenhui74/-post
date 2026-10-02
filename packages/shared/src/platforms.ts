/**
 * GEO 发文顺序：门户主站 → 腾讯系 → 技术站/专栏 → 百家号。
 * baike / website 只做核对清单，不走自动发表。
 */
export const PLATFORM_IDS = [
  "sohu",
  "netease",
  "toutiao",
  "zhihu",
  "qiehao",
  "weixin",
  "csdn",
  "juejin",
  "cnblogs",
  "bilibili",
  "baijiahao",
  "baike",
  "website",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** 企鹅独家仍允许发公众号：同属腾讯系。 */
export const TENCENT_FAMILY: PlatformId[] = ["qiehao", "weixin"];

export const CHECKLIST_IDS: PlatformId[] = ["baike", "website"];

/**
 * 打开官方编辑器填标题/正文/封面/声明，停在编辑器等人点发布。
 * 扩展永不点官方发布按钮。
 */
export const FILL_EDITOR_IDS: PlatformId[] = [
  "sohu",
  "netease",
  "toutiao",
  "zhihu",
  "qiehao",
  "csdn",
  "juejin",
  "cnblogs",
];

/** 微信 / B 站专栏 / 百家号：保存稿件接口 + 跳官方编辑页，永不群发/上线。 */
export const SAVE_DRAFT_EDITOR_IDS: PlatformId[] = ["weixin", "bilibili", "baijiahao"];

export function isChecklistPlatform(id: PlatformId): boolean {
  return CHECKLIST_IDS.includes(id);
}

export function isFillEditorPlatform(id: PlatformId): boolean {
  return (FILL_EDITOR_IDS as readonly string[]).includes(id);
}

export function isSaveDraftEditorPlatform(id: PlatformId): boolean {
  return (SAVE_DRAFT_EDITOR_IDS as readonly string[]).includes(id);
}

/**
 * 单站刷新可以后台打开编辑器扫表单项。
 * 公众号 / B 站 / 百家号 / 掘金一开会建空草稿，禁止为扫选项去开。
 */
export function canOpenEditorToScan(id: PlatformId): boolean {
  if (!isFillEditorPlatform(id)) return false;
  return id !== "juejin";
}

/** 已废弃：产品路径永远不点发布，恒为 false。 */
export function isAutoPublishMode(_mode: "draft" | "publish"): boolean {
  return false;
}

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  sohu: "搜狐号",
  netease: "网易号",
  toutiao: "头条号",
  zhihu: "知乎",
  qiehao: "企鹅号",
  weixin: "微信公众号",
  csdn: "CSDN",
  juejin: "掘金",
  cnblogs: "博客园",
  bilibili: "B站专栏",
  baijiahao: "百家号",
  baike: "百度百科",
  website: "企业官网",
};
