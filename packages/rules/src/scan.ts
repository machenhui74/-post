import type { BrandProfile, ValidationIssue } from "@geopost/shared";

const WECHAT_RE = /微信号|wxid_|微信\s*[:：]|vxi?n|vx\s*[:：]/i;
const CONTACT_RE = /qq\s*[:：]\s*\d{5,}|加我微信|扫描二维码|二维码|网盘链接|pan\.baidu/i;
const MEDICAL_RE = /根治|疗效百分[之百]|几天见效|包治|特效药|无副作用/;
const FINANCE_RE = /稳赚|保本|荐股|内幕消息|必涨|带盘|目标价/;
const CLICKBAIT_RE = /震惊|不看后悔|全网唯一|惊曝|内幕曝光/;
const NEWS_VOICE_RE = /本报讯|据新华社|本台记者/;
const UNIQUE_CLAIM_RE = /只有我们最|业内最权威|独一无二|全球唯一/;
const PERCENT_RE = /\d+(?:\.\d+)?%\s*(?:以上|左右)?|[一二三四五六七八九十]倍|\d+(?:\.\d+)?\s*倍/;
const SOURCE_HINT_RE = /据.{0,12}(报告|公报|白皮书|统计|官网|年报)|出处|来源[:：]|事实卡/;
const QUOTE_RE = /据(.{1,16}?)(表示|指出|称|报告|研究|白皮书)/g;

function sentences(text: string): string[] {
  return text.split(/[。！？!?\n]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 发布前红线扫描：只拦截公开规则里明确禁止的导流/承诺/标题党，不做绕审。
 */
export function scanCopy(text: string, platform?: ValidationIssue["platform"]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string) => {
    issues.push({ code, message, platform });
  };

  if (WECHAT_RE.test(text) || CONTACT_RE.test(text)) {
    push("GUIDE_CONTACT", "正文含微信号/二维码/网盘等导流信息，六平台均禁止。");
  }
  if (MEDICAL_RE.test(text)) {
    push("MEDICAL_CLAIM", "出现疗效承诺或根治话术，无医疗资质不可发布。");
  }
  if (FINANCE_RE.test(text)) {
    push("FINANCE_PITCH", "出现荐股/保本/带盘话术，无投资咨询资质不可发布。");
  }
  if (CLICKBAIT_RE.test(text)) {
    push("CLICKBAIT", "标题或正文含标题党用语，容易被扣信用分。");
  }
  if (NEWS_VOICE_RE.test(text)) {
    push("NEWS_VOICE", "使用新闻采编口吻。无许可不得发时政报道评论体。");
  }
  return issues;
}

/**
 * GEO 造假口：假统计/假引语。只警告，避免老稿全军覆没。
 */
export function scanHonesty(
  text: string,
  brand?: BrandProfile | null,
  platform?: ValidationIssue["platform"],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string) => {
    issues.push({ code, message, platform });
  };

  if (UNIQUE_CLAIM_RE.test(text) && !CLICKBAIT_RE.test(text)) {
    push("UNIQUE_CLAIM", "出现「只有我们最权威」类宣称，GEO 论文里的权威腔在竞争下无效且像营销。");
  }

  for (const sent of sentences(text)) {
    if (PERCENT_RE.test(sent) && !SOURCE_HINT_RE.test(sent) && !/事实卡/.test(sent)) {
      push("FAKE_STAT", "出现百分比或倍数但同句没有具体出处（机构/报告/事实卡）。");
      break;
    }
  }

  const known = new Set<string>();
  if (brand?.name) known.add(brand.name);
  for (const a of brand?.aliases ?? []) known.add(a);
  for (const f of brand?.facts ?? []) {
    if (f.grade === "unknown") continue;
    known.add(f.label);
    if (f.value) known.add(f.value);
    if (f.evidence) known.add(f.evidence);
  }
  QUOTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUOTE_RE.exec(text))) {
    const who = (m[1] ?? "").trim();
    if (!who || /公开资料|业内人士|相关专家|有关部门/.test(who)) {
      push("FAKE_QUOTE", `「据${who || "…"}」缺少可核验主体，禁止虚构来源。`);
      break;
    }
    const hit = [...known].some((k) => k && (who.includes(k) || k.includes(who)));
    if (brand?.facts.length && !hit) {
      push("FAKE_QUOTE", `「据${who}」不在事实卡中，禁止发明报告或发言人。`);
      break;
    }
  }
  return issues;
}
