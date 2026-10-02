import type { BrandProfile, ContentQuestion, EngineId, KnowledgeDoc, PlatformId } from "@geopost/shared";
import { ENGINE_LABELS, PLATFORM_IDS } from "@geopost/shared";
import { formatFactsForPrompt, formatKnowledgeForPrompt } from "./facts.js";
import guidelines from "./geo-guidelines.json";
import { getRule, listRules } from "./catalog.js";

const QUALITY_RULES = (guidelines as { filtered_rules: string[] }).filtered_rules;

/** 系统提示只写禁止项与可引用结构，不写规避审核的操作。 */
export const SYSTEM_GUARD = `你是中文长文写手，为多个内容平台改写同一主题。遵守：
1. 使用了生成能力就必须视为 AI 辅助，不得建议用户隐瞒或去标识。
2. 不得把同一事实包装成所有平台都「独家/首发」。
3. 禁止：微信号/二维码/外链导流、疗效承诺、荐股保本、无许可的时政报道评论体、标题党（震惊/不看后悔/全网唯一）。
4. 先结论后解释；用小标题；文首或文末写清作者、日期、来源（可写「作者：主题方 / 日期：今天 / 来源：公开资料」）；事实与观点分开；不确定就写不确定。
5. 各平台事实口径一致（数字、日期、机构名），结构、例子、FAQ 按平台改，避免同源复读。
6. 百科/官网只出中性核对提纲，不要写成可一键提交的营销稿。
7. 禁止虚构引语、虚构统计、虚构机构、虚构客户与奖项。百分比和倍数必须带来源。
8. 只能使用事实卡里 grade 非 unknown 的条目，以及用户勾选的知识库 Markdown；待确认事实不得写进正文。知识库与事实卡冲突时以事实卡为准。
9. 输出严格 JSON，不要 Markdown 围栏。`;

export interface GeneratePromptInput {
  topic: string;
  brand?: BrandProfile | null;
  questions?: ContentQuestion[];
  engines?: EngineId[];
  /** 只让模型写这些站，避免 13 份同构长文一次吐完。 */
  platforms?: PlatformId[];
  /** 勾选的知识库 Markdown，生成必须参考。 */
  knowledge?: KnowledgeDoc[];
}

function qualityBlock(): string {
  return `加分约束（禁止「不择手段提高被引用率」）：\n${QUALITY_RULES.map((r) => `- ${r}`).join("\n")}`;
}

export function buildGeneratePrompt(input: GeneratePromptInput | string): string {
  const ctx: GeneratePromptInput = typeof input === "string" ? { topic: input } : input;
  const targetIds = (ctx.platforms?.length ? ctx.platforms : [...PLATFORM_IDS]).filter((id) =>
    PLATFORM_IDS.includes(id),
  );
  const styles = listRules()
    .filter((r) => targetIds.includes(r.id))
    .map((r) => {
      const blocks = r.extractBlocks?.length ? `；必含块 ${r.extractBlocks.join("/")}` : "";
      return `- ${r.id}（${r.label}/${r.kind}）：标题建议 ${r.title.recommendMin}-${r.title.recommendMax} 字；${r.styleHint}${blocks}`;
    })
    .join("\n");

  const picked = (ctx.questions ?? []).filter((q) => q.selected).slice(0, 12);
  const qLines = picked.length
    ? `买家问题（按意图改结构，不要多篇同构资讯）：\n${picked
        .map((q) => `- [${q.intent}${q.excludeFromVisibility ? "/不计入可见性" : ""}] ${q.text}`)
        .join("\n")}`
    : "";

  const factText = formatFactsForPrompt(ctx.brand);
  const kbText = formatKnowledgeForPrompt(ctx.knowledge);
  const engineText = ctx.engines?.length
    ? `目标生成引擎：${ctx.engines.map((e) => ENGINE_LABELS[e]).join("、")}。信源站结构按该引擎偏好写。`
    : "";

  const platformFields = targetIds
    .map((id) => `    "${id}": { "title": "", "summary": "", "markdown": "", "category": "", "tags": [] }`)
    .join(",\n");

  return `主题：${ctx.topic}
${engineText}

${qualityBlock()}

${factText ? `事实卡：\n${factText}\n` : "未提供事实卡：不要编造成立时间、客户名、百分比、奖项。\n"}
${kbText ? `${kbText}\n` : ""}
${qLines}

文首 80 字内必须有一句可独立抽取的定义（是什么、服务谁、不服务谁）。

本次只写这些平台（不要写未列出的站）：${targetIds.join("、")}

请生成 JSON，字段：
{
  "master": { "title": "", "summary": "", "markdown": "" },
  "imagePrompts": ["英文或中文生图提示，2-3 条，适合做封面/配图"],
  "platforms": {
${platformFields}
  }
}

平台差异：
${styles}

母稿写完整长文，并包含作者、日期、来源三行。发文平台必须改结构与例子，这三项事实口径保持一致。
知乎用「问题+直接回答+依据+边界」。
CSDN/掘金/博客园用技术步骤+代码或配置，不要资讯腔。
B站专栏可轻松但仍要可核验步骤。
微信公众号注意阅读节奏和封面。
百科：中性词条提纲（定义、时间、产品、来源）。
官网：可作为 canonical 的完整主版本。`;
}

export function platformStyle(id: PlatformId): string {
  return getRule(id).styleHint;
}

/** 从事实卡 + 已勾选知识库扩口语问题，必须人工勾选后再用于写稿。 */
export function buildQuestionBankPrompt(brand: BrandProfile, topic?: string, knowledge?: KnowledgeDoc[]): string {
  const kbText = formatKnowledgeForPrompt(knowledge);
  const factText = formatFactsForPrompt(brand) || "无";
  return `根据「事实卡」和「已勾选知识库」生成 15～25 道中文口语买家问题（不要翻译腔、不要 SEO 词堆）。
两份材料都要用：
- 事实卡：数字、机构、产品名、日期必须原样进入问题口径，禁止另编。
- 知识库：把其中的场景、流程、能力边界、FAQ、对比点改写成买家会问的口语题，不要只围着品牌名空转。
某一侧为空就只用另一侧，不要编造缺失侧的数字或功能。
覆盖维度：recommend/compare/alternative/price/risk/scenario/brand，每类 2～4 题。
brand 类是点名核对口径的题，excludeFromVisibility 必须为 true，其余为 false。

品牌：${brand.name || "（未填名称）"}
别名：${brand.aliases.join("、") || "无"}
产品：${brand.products.join("、") || "无"}
主题：${topic?.trim() || "围绕品牌与知识库本身"}
事实卡：
${factText}
${kbText ? `\n${kbText}\n` : "\n未勾选知识库：问题只能来自事实卡，不要虚构手册里没有的能力。\n"}
只输出 JSON：{"questions":[{"intent":"recommend","text":"…","excludeFromVisibility":false}]}`;
}

/** 高价值站缺块时的定向再写，禁止改数字/机构/日期。 */
export function buildRewritePrompt(input: {
  platform: PlatformId;
  topic: string;
  title: string;
  summary: string;
  markdown: string;
  missing: string[];
  brand?: BrandProfile | null;
  knowledge?: KnowledgeDoc[];
}): string {
  const rule = getRule(input.platform);
  const kbText = formatKnowledgeForPrompt(input.knowledge);
  return `只改写 ${rule.label} 这一篇。目标：补上缺失块 ${input.missing.join("、")}，并保持与事实卡完全一致。
禁止改数字、日期、机构名、产品名；禁止虚构出处。
主题：${input.topic}
${formatFactsForPrompt(input.brand)}
${kbText}
当前标题：${input.title}
当前摘要：${input.summary}
当前正文：
${input.markdown}

只输出 JSON：{"title":"","summary":"","markdown":""}
文风：${rule.styleHint}
必含块：${(rule.extractBlocks ?? []).join("、")}`;
}

function zhCount(text: string): number {
  return Array.from(text.trim()).length;
}

/** 把该站字数、封面、必含块、文风收成审核用的发文标准。 */
export function formatPlatformStandard(id: PlatformId): string {
  const rule = getRule(id);
  const lines = [
    `平台：${rule.label}（${id}，${rule.kind === "checklist" ? "只出提纲不代发" : "发文站"}）`,
    `标题 ${rule.title.min}–${rule.title.max} 字（建议 ${rule.title.recommendMin ?? rule.title.min}–${rule.title.recommendMax ?? rule.title.max}）`,
    `正文 ${rule.body.min}–${rule.body.max} 字（建议 ${rule.body.recommendMin ?? rule.body.min}–${rule.body.recommendMax ?? rule.body.max}）`,
    `摘要 ${rule.summary.required ? "必填" : "选填"}，最多 ${rule.summary.max} 字`,
    `封面：${
      rule.cover.required
        ? `必须 ${rule.cover.minCount}–${rule.cover.maxCount} 张`
        : `可选，最多 ${rule.cover.maxCount} 张`
    }，比例 ${rule.cover.ratio}${rule.cover.mustBeInBody ? "；封面必须来自正文图" : ""}`,
    `分类须落在：${rule.categories.join("、")}`,
    `文风：${rule.styleHint}`,
    `必含可抽取块：${(rule.extractBlocks ?? []).join("、") || "无"}`,
  ];
  if (rule.checklist?.length) lines.push(`人工核对：${rule.checklist.join("；")}`);
  return lines.join("\n");
}

/**
 * 填入前的按站审核改写。不合格必须改到字数/结构/红线合格；封面缺失只能在 unfixed 里说明。
 */
export function buildReviewFixPrompt(input: {
  platform: PlatformId;
  topic: string;
  title: string;
  summary: string;
  markdown: string;
  issues: string[];
  brand?: BrandProfile | null;
  knowledge?: KnowledgeDoc[];
}): string {
  const rule = getRule(input.platform);
  const issueText = input.issues.length ? input.issues.map((s) => `- ${s}`).join("\n") : "- 程序扫描暂无硬伤，仍须按文风与必含块复核。";
  const kbText = formatKnowledgeForPrompt(input.knowledge);
  return `你是 ${rule.label} 的发文审核编辑。用下面该站公开标准审核稿件。
不合格就必须改到合适（标题/正文/摘要字数、必含块、标题党、导流、疗效承诺、资讯腔等）。
禁止改事实卡中的数字、日期、机构名、产品名；禁止虚构出处、客户、奖项。
封面图你无法生成：缺封面写进 unfixed，不要用假图片 URL 充数。
已合格则 pass=true，正文只做必要润色。

发文标准：
${formatPlatformStandard(input.platform)}

主题：${input.topic}
${formatFactsForPrompt(input.brand) || "无事实卡"}
${kbText}

程序扫描问题：
${issueText}

当前字数：标题 ${zhCount(input.title)}，摘要 ${zhCount(input.summary)}，正文 ${zhCount(input.markdown)}

当前标题：${input.title}
当前摘要：${input.summary}
当前正文：
${input.markdown}

只输出 JSON：
{"pass":false,"notes":["改了什么或为何合格"],"unfixed":["改不了的项，没有则空数组"],"title":"","summary":"","markdown":""}`;
}
