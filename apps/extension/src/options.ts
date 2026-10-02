import type { EditorCategoryOption, EditorExtraField, EditorOptionCatalog, PlatformId } from "@geopost/shared";
import { isChecklistPlatform } from "@geopost/shared";
import { staticEditorCatalog } from "@geopost/rules";

/**
 * 创作者后台同源分类接口。失败就退回静态列表，不要为扫选项去打开发文页（掘金/公众号一开会建空草稿）。
 * 掘金这条是站点自己用的公开分类接口。
 */
const CATEGORY_URLS: Partial<Record<PlatformId, string[]>> = {
  juejin: ["https://api.juejin.cn/tag_api/v1/query_category_briefs"],
};

const LABEL_KEYS = ["name", "label", "title", "categoryName", "category_name", "channelName", "columnName", "tag_name", "tagName"];
const ID_KEYS = ["id", "category_id", "categoryId", "code", "value", "cid", "columnId"];
const CHILD_KEYS = ["children", "child", "subList", "sub_list", "list", "channels", "items"];

function pickLabel(rec: Record<string, unknown>): string | undefined {
  for (const key of LABEL_KEYS) {
    const val = rec[key];
    if (typeof val === "string" && val.trim() && val.trim().length <= 24) return val.trim();
  }
  return undefined;
}

function pickId(rec: Record<string, unknown>, fallback: string): string {
  for (const key of ID_KEYS) {
    const val = rec[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number" && Number.isFinite(val)) return String(val);
  }
  return fallback;
}

/** 在 JSON 里找「像分类列表」的对象数组，避开用户/文章列表。 */
function collectNamedOptions(obj: unknown, depth = 0, prefer = false): EditorCategoryOption[] {
  if (!obj || depth > 6) return [];
  if (Array.isArray(obj)) {
    const items: EditorCategoryOption[] = [];
    for (const el of obj) {
      if (!el || typeof el !== "object") continue;
      const rec = el as Record<string, unknown>;
      const label = pickLabel(rec);
      if (!label) continue;
      let children: EditorCategoryOption[] = [];
      for (const ck of CHILD_KEYS) {
        if (rec[ck] == null) continue;
        children = collectNamedOptions(rec[ck], depth + 1, true);
        if (children.length) break;
      }
      items.push({ id: pickId(rec, label), label, children: children.length ? children : undefined });
    }
    if (prefer && items.length >= 1) return items;
    if (items.length >= 3) return items;
    for (const el of obj) {
      const nested = collectNamedOptions(el, depth + 1, prefer);
      if (nested.length >= 3) return nested;
    }
    return [];
  }
  if (typeof obj !== "object") return [];
  const rec = obj as Record<string, unknown>;
  for (const key of ["categories", "categoryList", "category_list", "channels", "channelList", "columns", "column_list"]) {
    if (rec[key] == null) continue;
    const found = collectNamedOptions(rec[key], depth + 1, true);
    if (found.length >= 1) return found;
  }
  for (const key of ["data", "result", "list"]) {
    if (rec[key] == null) continue;
    const found = collectNamedOptions(rec[key], depth + 1, prefer);
    if (found.length >= 2) return found;
  }
  return [];
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return null;
  }
}

async function categoriesFromApis(id: PlatformId): Promise<EditorCategoryOption[]> {
  for (const url of CATEGORY_URLS[id] ?? []) {
    const json = await fetchJson(url);
    const found = collectNamedOptions(json);
    if (found.length >= 2) return found;
  }
  return [];
}

interface DomScan {
  href: string;
  categories: EditorCategoryOption[];
  tags: string[];
  foundToggleLabels: string[];
  summaryVisible: boolean;
  summaryLabel: string;
  extraFields: Array<{
    label: string;
    kind: "text" | "search" | "select" | "radio" | "checkbox";
    placeholder?: string;
    options?: string[];
    fillable: boolean;
  }>;
}

function looksLikeEditor(href: string): boolean {
  return /publish|editor|write|addarticle|appmsg_edit|articlePublish|creation|posts\/edit|builder\/rc\/edit|graphic/i.test(
    href,
  );
}

/**
 * 注入到已打开的后台/编辑 tab：分类、声明，以及发文页左侧标签对应的额外表单项。
 * 必须是独立函数，不能闭包模块变量。
 */
function scanPageOptions(): DomScan {
  const navish = (el: Element): boolean =>
    Boolean((el as HTMLElement).closest?.("aside, nav, header, [class*='sidebar'], [class*='sider-menu']"));
  const isShown = (el: HTMLElement): boolean => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  };

  const categories: EditorCategoryOption[] = [];
  const seen = new Set<string>();
  const addCat = (raw: string) => {
    const label = raw.replace(/\s+/g, " ").trim();
    if (!label || label.length > 20 || seen.has(label)) return;
    if (/请选择|选择分类|选择栏目|全部|更多/.test(label)) return;
    seen.add(label);
    categories.push({ id: label, label });
  };

  for (const sel of Array.from(document.querySelectorAll("select"))) {
    if (!(sel instanceof HTMLSelectElement) || navish(sel)) continue;
    const host = `${sel.getAttribute("name") ?? ""} ${sel.id} ${sel.className} ${sel.getAttribute("aria-label") ?? ""}`;
    const nearby = (sel.closest("label, .form-item, [class*='form']")?.textContent ?? "").slice(0, 40);
    if (!/分类|栏目|频道|类型|话题|专栏/.test(`${host} ${nearby}`) && sel.options.length < 4) continue;
    for (const opt of Array.from(sel.options)) addCat(opt.textContent ?? "");
  }

  const tags: string[] = [];
  const tagSeen = new Set<string>();
  for (const el of Array.from(document.querySelectorAll("[class*='tag']"))) {
    if (navish(el)) continue;
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 16 || tagSeen.has(t)) continue;
    if (/标签|添加|热门/.test(t) && t.length < 4) continue;
    tagSeen.add(t);
    if (tags.length < 20) tags.push(t);
  }

  const foundToggleLabels: string[] = [];
  const toggleNeedles = [
    "生成合成",
    "AI生成",
    "AI 生成",
    "引用AI",
    "引用 AI",
    "包含 AI",
    "AI 辅助",
    "创作声明",
    "作品声明",
    "声明原创",
    "原创",
    "头条首发",
    "首发",
    "独家",
    "个人观点",
  ];
  for (const el of Array.from(document.querySelectorAll("label, span, div, p, li"))) {
    if (!(el instanceof HTMLElement) || navish(el)) continue;
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 18) continue;
    if (!toggleNeedles.some((n) => t.includes(n))) continue;
    if (!foundToggleLabels.includes(t)) foundToggleLabels.push(t);
  }

  let summaryVisible = false;
  let summaryLabel = "摘要";
  for (const el of Array.from(document.querySelectorAll("textarea, input"))) {
    if (!(el instanceof HTMLElement) || navish(el)) continue;
    const ph = `${(el as HTMLInputElement).placeholder ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
    if (/摘要|导语|简介/.test(ph)) {
      summaryVisible = true;
      if (/导语/.test(ph)) summaryLabel = "导语";
      else if (/简介/.test(ph)) summaryLabel = "简介";
      break;
    }
  }

  const extraFields: DomScan["extraFields"] = [];
  const extraSeen = new Set<string>();
  const BUILTIN_LABEL = /^(标题|正文|内容|封面|展示封面|摘要|导语|简介|分类|栏目|频道|标签|作品类型)$/;
  const TOGGLE_LABEL = /生成合成|引用\s*AI|AI\s*生成|AI\s*辅助|创作声明|作品声明|声明原创|^原创$|头条首发|^首发$|^独家$|个人观点/;
  const SKIP_LABEL = /预览|详细了解|了解更多|上传|删除|确定|取消|保存|发布/;
  const NO_FILL = /广告|合集|微头条|维权|授权|收益|同时发布/;

  const formRowOf = (el: HTMLElement): HTMLElement | null => {
    let row: HTMLElement | null = el.parentElement;
    for (let i = 0; i < 5 && row; i += 1) {
      const rr = row.getBoundingClientRect();
      if (rr.width >= 220 && rr.height >= 28 && rr.height <= 160) return row;
      row = row.parentElement;
    }
    return el.parentElement;
  };

  const placeholderOf = (row: HTMLElement): string => {
    for (const n of Array.from(row.querySelectorAll("input, textarea, [placeholder]"))) {
      const ph = ((n as HTMLInputElement).placeholder ?? n.getAttribute("placeholder") ?? "").trim();
      if (ph && ph.length <= 40) return ph;
    }
    const t = (row.innerText ?? "").replace(/\s+/g, " ").trim();
    const m = t.match(/标记城市[^。]*|请选择[^。]{0,12}|请输入[^。]{0,12}/);
    return m ? m[0].slice(0, 40) : "";
  };

  const inferField = (
    row: HTMLElement,
    label: string,
  ): Omit<DomScan["extraFields"][number], "label" | "fillable"> | null => {
    const radios = row.querySelectorAll("input[type='radio']");
    const checks = row.querySelectorAll("input[type='checkbox']");
    const selects = Array.from(row.querySelectorAll("select")) as HTMLSelectElement[];
    const texts = Array.from(
      row.querySelectorAll("input:not([type='hidden']):not([type='file']):not([type='radio']):not([type='checkbox'])"),
    ) as HTMLInputElement[];
    const ph = placeholderOf(row);
    const optionTexts = Array.from(row.querySelectorAll("label, span"))
      .map((n) => ((n as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 2 && t.length <= 14 && t !== label && !SKIP_LABEL.test(t));

    if (radios.length >= 2) {
      const options = [...new Set(optionTexts)].slice(0, 6);
      return { kind: "radio", placeholder: ph || undefined, options: options.length ? options : undefined };
    }
    if (selects[0] && selects[0].options.length) {
      return {
        kind: "select",
        placeholder: ph || undefined,
        options: Array.from(selects[0].options)
          .map((o) => (o.textContent ?? "").trim())
          .filter(Boolean),
      };
    }
    if (checks.length && texts.length === 0 && radios.length === 0) {
      return { kind: "checkbox", placeholder: ph || undefined };
    }
    if (/城市|同城|位置|搜索/.test(ph) || /位置/.test(label)) {
      return { kind: "search", placeholder: ph || undefined };
    }
    if (texts.length || /请输入|请选择|标记/.test(ph)) {
      return { kind: "text", placeholder: ph || undefined };
    }
    if (row.querySelector("[role='combobox'], [class*='select'], [class*='picker']")) {
      return { kind: /位置|城市/.test(`${label}${ph}`) ? "search" : "text", placeholder: ph || undefined };
    }
    return null;
  };

  const pushField = (label: string, row: HTMLElement) => {
    if (extraSeen.has(label) || BUILTIN_LABEL.test(label) || TOGGLE_LABEL.test(label) || SKIP_LABEL.test(label)) return;
    const inferred = inferField(row, label);
    if (!inferred) return;
    extraSeen.add(label);
    extraFields.push({
      label,
      kind: inferred.kind,
      placeholder: inferred.placeholder,
      options: inferred.options,
      fillable: !NO_FILL.test(label) && (inferred.kind === "text" || inferred.kind === "search" || inferred.kind === "select"),
    });
  };

  for (const el of Array.from(document.querySelectorAll("div, span, label, p, td, th, dt")) as HTMLElement[]) {
    if (extraFields.length >= 16) break;
    if (!isShown(el) || navish(el)) continue;
    const label = (el.innerText ?? "").replace(/\s+/g, " ").trim();
    if (label.length < 2 || label.length > 10) continue;
    if (el.childElementCount > 2) continue;
    const box = el.getBoundingClientRect();
    if (box.left > 420 || box.width > 180 || box.height > 48) continue;
    const row = formRowOf(el);
    if (!row) continue;
    const rowText = (row.innerText ?? "").replace(/\s+/g, " ").trim();
    if (rowText.length > 200) continue;
    pushField(label, row);
  }

  // 占位符兜底：自定义下拉经常没有原生 input，但能看见「标记城市」。
  for (const el of Array.from(document.querySelectorAll("div, span, input, p")) as HTMLElement[]) {
    if (extraFields.length >= 16) break;
    if (!isShown(el) || navish(el)) continue;
    const ph = `${(el as HTMLInputElement).placeholder ?? ""} ${(el.innerText ?? "").replace(/\s+/g, "")}`;
    if (!/标记城市|同城用户/.test(ph) || ph.length > 48) continue;
    const row = formRowOf(el);
    if (!row) continue;
    const labelNode = Array.from(row.querySelectorAll("div, span, label, p")).find((n) => {
      const t = ((n as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
      return t.length >= 2 && t.length <= 8 && !/标记|同城|请选择/.test(t);
    });
    const label = ((labelNode as HTMLElement | undefined)?.innerText ?? "添加位置").replace(/\s+/g, " ").trim();
    pushField(label || "添加位置", row);
  }

  return {
    href: location.href,
    categories,
    tags,
    foundToggleLabels,
    summaryVisible,
    summaryLabel,
    extraFields,
  };
}

async function scanTab(tabId: number): Promise<DomScan | null> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: scanPageOptions,
    });
    return (injected[0]?.result as DomScan | undefined) ?? null;
  } catch {
    return null;
  }
}

function mergeToggleLabels(base: EditorOptionCatalog, found: string[]): void {
  for (const t of base.toggles) {
    if (!t.visible) continue;
    const hit = found.find((x) => x.includes(t.label) || t.label.includes(x));
    if (hit) t.label = hit;
  }
}

function applyExtraFields(catalog: EditorOptionCatalog, fields: EditorExtraField[]): void {
  if (!fields.length) return;
  const byLabel = new Map((catalog.extraFields ?? []).map((f) => [f.label, f]));
  for (const field of fields) byLabel.set(field.label, field);
  catalog.extraFields = [...byLabel.values()];
  const loc = catalog.extraFields.find((f) => /位置/.test(f.label) || /城市|同城/.test(f.placeholder ?? ""));
  if (loc) {
    catalog.locationVisible = true;
    catalog.locationLabel = loc.label;
  }
}

function mergeCatalog(
  base: EditorOptionCatalog,
  live: {
    categories: EditorCategoryOption[];
    tags: string[];
    foundToggleLabels: string[];
    summaryVisible?: boolean;
    summaryLabel?: string;
    fromEditor?: boolean;
    extraFields?: EditorExtraField[];
  },
  source: EditorOptionCatalog["source"],
): EditorOptionCatalog {
  const next: EditorOptionCatalog = {
    ...base,
    toggles: base.toggles.map((t) => ({ ...t })),
    extraFields: [...(base.extraFields ?? [])],
    source,
  };
  if (live.categories.length >= 2) next.categories = live.categories;
  if (live.tags.length) next.tags = live.tags;
  mergeToggleLabels(next, live.foundToggleLabels);
  if (live.fromEditor) {
    next.summaryVisible = Boolean(live.summaryVisible);
    if (live.summaryLabel) next.summaryLabel = live.summaryLabel;
  }
  applyExtraFields(next, live.extraFields ?? []);
  return next;
}

/**
 * 登录已确认后拉可选项。优先接口和已打开的 tab；打开发文页由 probe 决定。
 */
export async function collectOptions(
  id: PlatformId,
  opts: { tabId?: number; tabIds?: number[]; accountName?: string } = {},
): Promise<EditorOptionCatalog> {
  const base = staticEditorCatalog(id);
  base.accountName = opts.accountName;
  if (isChecklistPlatform(id)) return base;

  let source: EditorOptionCatalog["source"] = "static";
  const live = {
    categories: [] as EditorCategoryOption[],
    tags: [] as string[],
    foundToggleLabels: [] as string[],
    summaryVisible: false,
    summaryLabel: base.summaryLabel,
    fromEditor: false,
    extraFields: [] as EditorExtraField[],
  };

  const fromApi = await categoriesFromApis(id);
  if (fromApi.length >= 2) {
    live.categories = fromApi;
    source = "api";
  }

  const scanIds = [...new Set([...(opts.tabIds ?? []), opts.tabId].filter((n): n is number => typeof n === "number"))];

  for (const tabId of scanIds) {
    const dom = await scanTab(tabId);
    if (!dom) continue;
    const editor = looksLikeEditor(dom.href);
    if (dom.categories.length >= 2 && live.categories.length < 2) {
      live.categories = dom.categories;
      source = source === "api" ? "mixed" : "dom";
    }
    if (dom.tags.length && !live.tags.length) live.tags = dom.tags;
    live.foundToggleLabels.push(...dom.foundToggleLabels);
    if (editor) {
      live.fromEditor = true;
      live.summaryVisible = dom.summaryVisible;
      live.summaryLabel = dom.summaryLabel;
      source = source === "static" ? "dom" : source === "api" ? "mixed" : source;
      if (dom.extraFields.length) {
        const byLabel = new Map(live.extraFields.map((f) => [f.label, f]));
        for (const field of dom.extraFields) byLabel.set(field.label, field);
        live.extraFields = [...byLabel.values()];
      }
    }
  }

  return mergeCatalog(base, live, source);
}

/** 已打开的后台/编辑 tab 都扫；发文页优先，避免只扫到首页漏掉位置等项。 */
export async function collectOptionsFromOpenTabs(
  id: PlatformId,
  tabMatch: string | string[],
  accountName?: string,
): Promise<EditorOptionCatalog> {
  const patterns = Array.isArray(tabMatch) ? tabMatch : [tabMatch];
  const tabIds: number[] = [];
  const seen = new Set<number>();
  for (const pattern of patterns) {
    if (!pattern) continue;
    const tabs = await chrome.tabs.query({ url: pattern });
    const complete = tabs.filter((t) => t.id && t.status === "complete" && t.url);
    complete.sort((a, b) => Number(looksLikeEditor(b.url ?? "")) - Number(looksLikeEditor(a.url ?? "")));
    for (const tab of complete) {
      if (!tab.id || seen.has(tab.id)) continue;
      seen.add(tab.id);
      tabIds.push(tab.id);
    }
  }
  return collectOptions(id, { tabIds, accountName });
}
