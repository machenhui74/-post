import type { BrandProfile, PlatformId, ValidationIssue } from "@geopost/shared";
import type { ExtractBlock } from "./types.js";

function firstChars(text: string, n: number): string {
  return Array.from(text.replace(/\s+/g, "")).slice(0, n).join("");
}

function headingCount(md: string): number {
  return (md.match(/^#{1,3}\s+.+/gm) ?? []).length;
}

/**
 * 可抽取块缺失只警告。definition 在有品牌名时才检查正式名。
 */
export function missingExtractBlocks(
  markdown: string,
  blocks: ExtractBlock[],
  platform: PlatformId,
  brand?: BrandProfile | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const body = markdown.trim();
  if (!body) return issues;
  const head = firstChars(body, 120);
  const names = [brand?.name, ...(brand?.aliases ?? [])].filter((s): s is string => Boolean(s?.trim()));

  for (const block of blocks) {
    let ok = true;
    let hint = "";
    if (block === "definition") {
      ok = names.length === 0 ? headingCount(body) > 0 || body.length > 40 : names.some((n) => head.includes(n));
      hint = names.length ? "文首 120 字内应出现品牌正式名或别名" : "文首应有可独立抽取的定义句";
    } else if (block === "numbers") {
      const hasNum = /\d/.test(body);
      const hasSrc = /出处|来源|据|报告|公报|白皮书|官网|统计/.test(body);
      ok = hasNum && hasSrc;
      hint = "正文应有具体数字，且同篇出现可核验出处";
    } else if (block === "comparison") {
      ok = /相比|对比|versus|vs\.|表格|\|.+\|/.test(body);
      hint = "知乎等站建议有对比或表格";
    } else if (block === "howto") {
      ok = /(^|\n)\s*(\d+[\.、]|[-*]\s)/m.test(body) || /第一步|步骤/.test(body);
      hint = "技术站应有有序步骤或列表";
    } else if (block === "boundary") {
      ok = /不适用于|不适用|不确定|边界|风险|局限性/.test(body);
      hint = "应写清不适用场景或不确定处";
    } else if (block === "faq") {
      const qs = (body.match(/[？?]/g) ?? []).length;
      ok = qs >= 2 || (body.match(/^#{1,3}\s+.+[？?]/gm) ?? []).length >= 2;
      hint = "建议至少两个问句小标题";
    }
    if (!ok) {
      issues.push({ code: "MISSING_BLOCK", message: `缺少可抽取块「${block}」：${hint}`, platform });
    }
  }
  return issues;
}
