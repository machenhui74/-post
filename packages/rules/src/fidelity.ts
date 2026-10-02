import type { BrandProfile, PlatformId, ValidationIssue } from "@geopost/shared";
import { allowedNumbersFromBrand, extractSignificantNumbers, usableFacts } from "./facts.js";

/**
 * 相对事实卡/母稿的数字保真。程序能做的先做，不引入未校准的 LLM 分。
 */
export function fidelityWarnings(
  text: string,
  platform: PlatformId,
  brand?: BrandProfile | null,
  master = "",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowed = allowedNumbersFromBrand(brand, `${master}\n`);
  if (allowed.size > 0) {
    for (const n of extractSignificantNumbers(text)) {
      if (!allowed.has(n)) {
        issues.push({
          code: "FACT_DRIFT",
          message: `出现事实卡/母稿/知识库中没有的显著数字「${n}」，请核对或补进事实卡。`,
          platform,
        });
        break;
      }
    }
  }

  for (const f of usableFacts(brand)) {
    const nums = extractSignificantNumbers(f.value);
    if (!nums.length) continue;
    const labelHit = f.label.length >= 2 && text.includes(f.label);
    if (labelHit && !nums.some((n) => text.includes(n))) {
      issues.push({
        code: "FACT_DRIFT",
        message: `提到「${f.label}」但未保留事实卡数字（${nums.join("、")}）。`,
        platform,
      });
    }
  }

  const unknown = brand?.facts.filter((f) => f.grade === "unknown" && f.value.trim().length >= 4) ?? [];
  for (const f of unknown) {
    if (text.includes(f.value.trim())) {
      issues.push({
        code: "UNKNOWN_FACT",
        message: `正文使用了待确认事实「${f.label}」，请先改 grade 或删掉。`,
        platform,
      });
    }
  }
  return issues;
}
