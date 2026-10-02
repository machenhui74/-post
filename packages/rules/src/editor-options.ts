import type {
  EditorCategoryOption,
  EditorExtraField,
  EditorOptionCatalog,
  EditorToggleOption,
  PlatformId,
} from "@geopost/shared";
import { getRule } from "./catalog.js";

/** 把树状分类摊成下拉文案。填表靠点同名文案，所以用叶子/节点自己的 label，不加「父 / 子」。 */
export function flattenCategoryLabels(items: EditorCategoryOption[] | undefined): string[] {
  if (!items?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (nodes: EditorCategoryOption[]) => {
    for (const node of nodes) {
      const label = node.label.trim();
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push(label);
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(items);
  return out;
}

function catsFromRule(id: PlatformId): EditorCategoryOption[] {
  return getRule(id).categories.map((label) => ({ id: label, label }));
}

function toggle(key: EditorToggleOption["key"], label: string, visible: boolean): EditorToggleOption {
  return { key, label, visible };
}

/**
 * 没扫到后台列表时的兜底。声明文案对齐官方页，不要统一写成「AI 声明」。
 * 登录刷新成功后会被接口/DOM 结果覆盖分类。
 */
export function staticEditorCatalog(id: PlatformId, at = new Date().toISOString()): EditorOptionCatalog {
  const rule = getRule(id);
  const s = rule.supports;
  const categories = catsFromRule(id);
  const summaryRequired = Boolean(rule.summary.required);
  const base = {
    platform: id,
    at,
    source: "static" as const,
    categories,
    tags: [] as string[],
    tagsVisible: false,
    summaryVisible: summaryRequired,
    summaryLabel: "摘要",
    extraFields: [] as EditorExtraField[],
    locationVisible: false,
    locationLabel: "添加位置",
  };

  const byId: Record<PlatformId, Omit<EditorOptionCatalog, "platform" | "at" | "source" | "categories">> = {
    sohu: {
      tags: [],
      tagsVisible: false,
      summaryVisible: true,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "生成合成", s.aiDeclaration),
        toggle("claimOriginal", "原创", s.original),
        toggle("claimFirstPublish", "首发", s.firstPublish),
        toggle("claimExclusive", "独家", s.exclusive),
      ],
    },
    netease: {
      tags: [],
      tagsVisible: false,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "生成合成", s.aiDeclaration),
        toggle("claimOriginal", "原创", s.original),
        toggle("claimFirstPublish", "首发", s.firstPublish),
        toggle("claimExclusive", "独家", s.exclusive),
      ],
    },
    toutiao: {
      tags: [],
      tagsVisible: false,
      summaryVisible: false,
      summaryLabel: "导语",
      toggles: [
        toggle("aiDeclared", "引用 AI", s.aiDeclaration),
        toggle("claimOriginal", "声明原创", s.original),
        toggle("claimFirstPublish", "头条首发", s.firstPublish),
        toggle("claimExclusive", "独家", s.exclusive),
      ],
    },
    zhihu: {
      tags: [],
      tagsVisible: false,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "包含 AI 辅助创作", s.aiDeclaration),
        toggle("claimOriginal", "原创", false),
        toggle("claimFirstPublish", "首发", false),
        toggle("claimExclusive", "独家", false),
      ],
    },
    qiehao: {
      tags: [],
      tagsVisible: false,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "生成合成", s.aiDeclaration),
        toggle("claimOriginal", "原创", s.original),
        toggle("claimFirstPublish", "首发", s.firstPublish),
        toggle("claimExclusive", "独家", s.exclusive),
      ],
    },
    weixin: {
      tags: [],
      tagsVisible: false,
      summaryVisible: true,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "创作声明", s.aiDeclaration),
        toggle("claimOriginal", "原创", false),
        toggle("claimFirstPublish", "首发", false),
        toggle("claimExclusive", "独家", false),
      ],
    },
    csdn: {
      tags: [],
      tagsVisible: true,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "AI 生成", s.aiDeclaration),
        toggle("claimOriginal", "原创", s.original),
        toggle("claimFirstPublish", "首发", s.firstPublish),
        toggle("claimExclusive", "独家", s.exclusive),
      ],
    },
    juejin: {
      tags: [],
      tagsVisible: true,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "AI 声明", false),
        toggle("claimOriginal", "原创", false),
        toggle("claimFirstPublish", "首发", false),
        toggle("claimExclusive", "独家", false),
      ],
    },
    cnblogs: {
      tags: [],
      tagsVisible: true,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "AI 声明", false),
        toggle("claimOriginal", "原创", false),
        toggle("claimFirstPublish", "首发", false),
        toggle("claimExclusive", "独家", false),
      ],
    },
    bilibili: {
      tags: [],
      tagsVisible: false,
      summaryVisible: true,
      summaryLabel: "简介",
      toggles: [
        toggle("aiDeclared", "AI 生成", s.aiDeclaration),
        toggle("claimOriginal", "原创", false),
        toggle("claimFirstPublish", "首发", false),
        toggle("claimExclusive", "独家", false),
      ],
    },
    baijiahao: {
      tags: [],
      tagsVisible: false,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "创作声明", s.aiDeclaration),
        toggle("claimOriginal", "原创", s.original),
        toggle("claimFirstPublish", "首发", s.firstPublish),
        toggle("claimExclusive", "独家", s.exclusive),
      ],
    },
    baike: {
      tags: [],
      tagsVisible: false,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "AI 声明", false),
        toggle("claimOriginal", "原创", false),
        toggle("claimFirstPublish", "首发", false),
        toggle("claimExclusive", "独家", false),
      ],
    },
    website: {
      tags: [],
      tagsVisible: false,
      summaryVisible: false,
      summaryLabel: "摘要",
      toggles: [
        toggle("aiDeclared", "AI 声明", false),
        toggle("claimOriginal", "原创", false),
        toggle("claimFirstPublish", "首发", false),
        toggle("claimExclusive", "独家", false),
      ],
    },
  };

  return { ...base, ...byId[id], platform: id, at, source: "static", categories };
}

/** 控制台下拉：实时目录优先，缺了再用规则，当前已选值始终保留以免刷新丢勾选。 */
export function categorySelectLabels(
  ruleCategories: string[],
  catalog: EditorOptionCatalog | undefined,
  current: string,
): string[] {
  const fromCatalog = flattenCategoryLabels(catalog?.categories);
  const merged = fromCatalog.length ? fromCatalog : ruleCategories;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of [current, ...merged]) {
    const t = label.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
