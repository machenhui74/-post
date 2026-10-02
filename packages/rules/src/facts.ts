import type { BrandFact, BrandProfile, KnowledgeDoc } from "@geopost/shared";

/** grade 非 unknown 且有值，才允许写进正文。 */
export function usableFacts(brand?: BrandProfile | null): BrandFact[] {
  if (!brand) return [];
  return brand.facts.filter((f) => f.grade !== "unknown" && f.value.trim().length > 0);
}

/** 给 Prompt 用的事实清单，unknown 单独列出禁止项。 */
export function formatFactsForPrompt(brand?: BrandProfile | null): string {
  if (!brand?.name && !brand?.facts.length) return "";
  const lines: string[] = [];
  if (brand.name) lines.push(`品牌正式名：${brand.name}`);
  if (brand.aliases.length) lines.push(`别名：${brand.aliases.join("、")}`);
  if (brand.products.length) lines.push(`产品：${brand.products.join("、")}`);
  if (brand.domains.length) lines.push(`域名：${brand.domains.join("、")}`);
  const ok = usableFacts(brand);
  if (ok.length) {
    lines.push("可用事实（必须原样使用数字/机构/日期）：");
    for (const f of ok.slice(0, 40)) {
      const src = f.evidence?.trim() ? `（出处：${f.evidence}）` : "";
      lines.push(`- ${f.label}：${f.value}${src}`);
    }
  }
  const banned = brand.facts.filter((f) => f.grade === "unknown" && f.value.trim());
  if (banned.length) {
    lines.push("禁止写入正文（待确认）：");
    for (const f of banned.slice(0, 20)) {
      lines.push(`- ${f.label}：${f.value}`);
    }
  }
  return lines.join("\n");
}

const KB_DOC_MAX = 8000;
const KB_TOTAL_MAX = 24000;

/** 已勾选知识库压进 Prompt；超长截断，避免一次撑爆上下文。 */
export function formatKnowledgeForPrompt(docs?: KnowledgeDoc[] | null): string {
  const picked = (docs ?? []).filter((d) => d.selected && d.markdown.trim());
  if (!picked.length) return "";
  const chunks: string[] = [];
  let used = 0;
  for (const d of picked) {
    const body = d.markdown.trim();
    const slice = body.length > KB_DOC_MAX ? `${body.slice(0, KB_DOC_MAX)}\n…（已截断）` : body;
    const block = `### ${d.title.trim() || "未命名"}\n${slice}`;
    if (used + block.length > KB_TOTAL_MAX) {
      chunks.push("（其余知识库条目因长度未全部注入）");
      break;
    }
    chunks.push(block);
    used += block.length;
  }
  return `知识库（已勾选，必须参考；不要整篇照抄；与事实卡冲突时以事实卡为准）：\n${chunks.join("\n\n")}`;
}

/** 保真比对用的纯文本：标题+正文拼在一起抽数字。 */
export function knowledgePlainText(docs?: KnowledgeDoc[] | null): string {
  return (docs ?? [])
    .filter((d) => d.selected && d.markdown.trim())
    .map((d) => `${d.title}\n${d.markdown}`)
    .join("\n");
}

const SIGNIFICANT_RE =
  /(?:19|20)\d{2}|\d+(?:\.\d+)?%|\d+(?:\.\d+)?[万亿]|\d{3,}(?:\.\d+)?/g;

/** 抽年份、百分比、万/亿、三位数以上，用来做保真比对。 */
export function extractSignificantNumbers(text: string): string[] {
  return text.match(SIGNIFICANT_RE) ?? [];
}

export function allowedNumbersFromBrand(brand?: BrandProfile | null, extra = ""): Set<string> {
  const set = new Set<string>();
  for (const n of extractSignificantNumbers(extra)) set.add(n);
  for (const f of usableFacts(brand)) {
    for (const n of extractSignificantNumbers(`${f.label} ${f.value}`)) set.add(n);
  }
  return set;
}
