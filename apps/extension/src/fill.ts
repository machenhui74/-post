import { isSaveDraftEditorPlatform, type PlatformId, type PublishTarget, type TaskResult } from "@geopost/shared";
import { getRule } from "@geopost/rules";
import { saveDraftThenOpenEditor } from "./saveDraft";
import { collectOptions } from "./options";

interface PackedImage {
  filename: string;
  mimeType: string;
  base64: string;
}

interface FillArg {
  title: string;
  html: string;
  markdown: string;
  summary: string;
  category: string;
  tags: string[];
  /** 发文页扫到的可填项，键是官方标签。 */
  extras: Record<string, string>;
  /** 忽略。产品路径永远只填表，不点发布。 */
  mode: "draft" | "publish";
  aiDeclared: boolean;
  claimOriginal: boolean;
  claimFirstPublish: boolean;
  claimExclusive: boolean;
  summaryRequired: boolean;
  coverImages: PackedImage[];
  bodyImages: PackedImage[];
  platform: PlatformId;
  /** 官方封面必填时，没挂上就算填表失败（标签页仍留着）。 */
  coverRequired: boolean;
  /** 官方允许的封面张数上限；头条按 1 张传，禁止一次塞一堆。 */
  coverMaxCount: number;
  /** 企鹅号一类：封面必须从正文图里选。 */
  coverMustBeInBody: boolean;
  /** 先点这些节点才能打开封面弹窗（搜狐 .upload-file.mp-upload）。 */
  coverOpenSelectors: string[];
  coverTabTexts: string[];
  coverConfirmSelectors: string[];
  /** 发布主按钮 CSS；命中后还要用文案过滤。 */
  publishSelectors: string[];
  /** 选择器没命中时只在这些 tag 上找文案，禁止扫任意 div/span。 */
  fallbackTags: string;
  /** ACTION_UI 主按钮文案，与 SELECTORS.publishTexts（草稿）分开。 */
  actionPublishTexts: string[];
  matchMode: "exact" | "includes";
  confirmTexts: string[];
  confirmSelectors: string[];
  successTexts: string[];
  preClickWaitMs: number;
  confirmWaitMs: number;
  enabledTimeoutMs: number;
  titleSelectors: string[];
  contentSelectors: string[];
  summarySelectors: string[];
  coverInputSelectors: string[];
  openTexts: string[];
  draftTexts: string[];
  publishTexts: string[];
  aiTexts: string[];
  originalTexts: string[];
  firstTexts: string[];
  exclusiveTexts: string[];
}

interface FillResult {
  ok: boolean;
  message: string;
  filledTitle?: boolean;
  filledBody?: boolean;
  filledSummary?: boolean;
  attachedCover?: boolean;
  declaredAi?: boolean;
  clicked?: boolean;
  /** 已废弃：不再点发布，恒为 false。 */
  published?: boolean;
}

type Spec = Omit<
  FillArg,
  | "title"
  | "html"
  | "markdown"
  | "summary"
  | "category"
  | "tags"
  | "extras"
  | "mode"
  | "aiDeclared"
  | "claimOriginal"
  | "claimFirstPublish"
  | "claimExclusive"
  | "summaryRequired"
  | "coverImages"
  | "bodyImages"
  | "platform"
  | "coverRequired"
  | "coverMaxCount"
  | "coverMustBeInBody"
  | "coverOpenSelectors"
  | "coverTabTexts"
  | "coverConfirmSelectors"
  | "publishSelectors"
  | "fallbackTags"
  | "actionPublishTexts"
  | "matchMode"
  | "confirmTexts"
  | "confirmSelectors"
  | "successTexts"
  | "preClickWaitMs"
  | "confirmWaitMs"
  | "enabledTimeoutMs"
>;

/** 封面入口不在正文编辑器里，要点指定节点才会出现 file input。 */
const COVER_UI: Record<
  PlatformId,
  { openSelectors: string[]; extraInputSelectors: string[]; tabTexts: string[]; confirmSelectors: string[] }
> = {
  sohu: {
    openSelectors: [
      "span.upload-tip",
      ".upload-file.mp-upload",
      ".upload-file",
      ".mp-upload",
      ".cover-img",
      "[class*='cover-upload']",
    ],
    extraInputSelectors: ["#new-file", 'input#new-file', 'label[for="new-file"]'],
    tabTexts: ["本地上传", "本地"],
    confirmSelectors: ["p.button.positive-button", ".board .positive-button", ".positive-button"],
  },
  netease: {
    openSelectors: [".upload-cover", "[class*='cover-upload']"],
    extraInputSelectors: [],
    tabTexts: ["本地上传"],
    confirmSelectors: [],
  },
  toutiao: {
    // 只点「加号」一次；[class*=cover-add] 太宽，会误中图库缩略图。
    openSelectors: ["div.article-cover-add", ".article-cover-add"],
    extraInputSelectors: [],
    tabTexts: ["上传图片"],
    confirmSelectors: ['button[data-e2e="imageUploadConfirm-btn"]'],
  },
  zhihu: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  qiehao: {
    openSelectors: [],
    extraInputSelectors: ["input[type=file][accept*='image']"],
    tabTexts: ["单图", "本地上传"],
    confirmSelectors: ["button.omui-button--primary"],
  },
  weixin: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  csdn: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  juejin: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  cnblogs: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  bilibili: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  baijiahao: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  baike: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
  website: { openSelectors: [], extraInputSelectors: [], tabTexts: [], confirmSelectors: [] },
};

type MatchMode = "exact" | "includes";

interface ActionUi {
  publishSelectors: string[];
  fallbackTags: string;
  publishTexts: string[];
  matchMode: MatchMode;
  confirmTexts: string[];
  confirmSelectors: string[];
  successTexts: string[];
  preClickWaitMs: number;
  confirmWaitMs: number;
  enabledTimeoutMs: number;
}

/** 每站一份发布按钮配置；真正点发布只走这里，不再全文扫 div/span。 */
function action(partial: Partial<ActionUi> & Pick<ActionUi, "publishTexts" | "successTexts">): ActionUi {
  return {
    publishSelectors: [],
    fallbackTags: "button, [role='button']",
    matchMode: "exact",
    confirmTexts: [],
    confirmSelectors: [],
    preClickWaitMs: 3500,
    confirmWaitMs: 2000,
    enabledTimeoutMs: 5000,
    ...partial,
  };
}

const ACTION_UI: Record<PlatformId, ActionUi> = {
  sohu: action({
    publishSelectors: ["li.positive-button", ".publish-btn", "button.publish"],
    fallbackTags: "li.positive-button, button, [role='button']",
    publishTexts: ["发布", "立即发布"],
    matchMode: "includes",
    confirmTexts: ["确定发布", "确认发布"],
    successTexts: ["发布成功", "提交成功", "已发布"],
  }),
  netease: action({
    fallbackTags: "button",
    publishTexts: ["发布"],
    matchMode: "exact",
    confirmTexts: ["确认发布", "确定发布"],
    successTexts: ["发布成功", "提交成功"],
  }),
  toutiao: action({
    publishSelectors: ["button.publish-btn"],
    fallbackTags: "button",
    publishTexts: ["预览并发布"],
    matchMode: "includes",
    // 不要再用 publish-btn：预览页上它仍是「预览并发布」，点第二下不等于发出去。
    confirmSelectors: [],
    confirmTexts: ["确认发布", "确定发布", "确认并发布"],
    successTexts: ["发布成功", "已提交", "提交成功", "审核中"],
    preClickWaitMs: 4000,
    confirmWaitMs: 2500,
    enabledTimeoutMs: 8000,
  }),
  zhihu: action({
    fallbackTags: "button",
    publishTexts: ["发布"],
    matchMode: "includes",
    confirmTexts: ["确认发布"],
    successTexts: ["发布成功"],
  }),
  qiehao: action({
    fallbackTags: "button",
    publishTexts: ["发布"],
    matchMode: "exact",
    confirmTexts: ["确认发表", "确认发布"],
    successTexts: ["发表成功", "发布成功"],
  }),
  weixin: action({
    fallbackTags: "button, [role='button']",
    publishTexts: ["发表", "群发"],
    matchMode: "exact",
    confirmTexts: ["发表", "继续发表"],
    successTexts: ["发表成功", "已群发", "群发成功"],
  }),
  csdn: action({
    fallbackTags: "button",
    publishTexts: ["发布文章", "发布"],
    matchMode: "includes",
    confirmTexts: ["确认发布"],
    successTexts: ["发布成功"],
  }),
  juejin: action({
    fallbackTags: "button",
    publishTexts: ["发布"],
    matchMode: "includes",
    confirmTexts: ["确定并发布", "确认发布"],
    successTexts: ["发布成功"],
  }),
  cnblogs: action({
    publishSelectors: ["#btnPublish", "input[value='发布']"],
    fallbackTags: "button, input[type='submit']",
    publishTexts: ["发布"],
    matchMode: "exact",
    successTexts: ["发布成功"],
  }),
  bilibili: action({
    fallbackTags: "button",
    publishTexts: ["提交", "发布"],
    matchMode: "exact",
    confirmTexts: ["确认提交"],
    successTexts: ["提交成功", "发布成功"],
  }),
  baijiahao: action({
    fallbackTags: "button",
    publishTexts: ["发布", "发表"],
    matchMode: "exact",
    confirmTexts: ["确认发布"],
    successTexts: ["发布成功", "提交成功"],
  }),
  baike: action({ publishTexts: [], successTexts: [] }),
  website: action({ publishTexts: [], successTexts: [] }),
};

const SELECTORS: Record<PlatformId, Spec> = {
  sohu: {
    titleSelectors: [".publish-title input", 'input[placeholder*="标题"]', "input.title", "textarea.title"],
    contentSelectors: ["#editor .ql-editor", "div.ql-editor[contenteditable='true']", ".ql-editor"],
    summarySelectors: ['textarea[placeholder*="摘要"]', "textarea.summary", "input.summary"],
    coverInputSelectors: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    openTexts: [],
    draftTexts: ["存草稿", "保存草稿"],
    publishTexts: ["发布", "立即发布"],
    aiTexts: ["生成合成", "AI生成", "人工智能生成", "生成式人工智能", "内容标识", "人工智能", "AIGC", "合成内容"],
    originalTexts: ["原创"],
    firstTexts: [],
    exclusiveTexts: [],
  },
  netease: {
    titleSelectors: [
      'textarea[placeholder*="请输入标题"]',
      'textarea[placeholder*="标题"]',
      'input[placeholder*="标题"]',
    ],
    contentSelectors: ['div[data-contents="true"]', ".public-DraftEditor-content", ".ql-editor", ".ProseMirror"],
    summarySelectors: ['textarea[placeholder*="摘要"]', "textarea.summary"],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["存草稿", "保存"],
    publishTexts: ["发布", "立即发布"],
    aiTexts: ["生成合成", "AI生成", "生成式人工智能"],
    originalTexts: ["原创"],
    firstTexts: [],
    exclusiveTexts: [],
  },
  toutiao: {
    titleSelectors: ['textarea[placeholder*="请输入文章标题"]', 'textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
    contentSelectors: [".ProseMirror", 'div.ProseMirror[contenteditable="true"]', ".ql-editor"],
    summarySelectors: ['textarea[placeholder*="摘要"]', 'textarea[placeholder*="导语"]'],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["暂存", "保存草稿"],
    publishTexts: ["预览并发布"],
    aiTexts: ["引用AI"],
    originalTexts: ["声明原创", "原创"],
    firstTexts: ["头条首发", "首发"],
    exclusiveTexts: [],
  },
  zhihu: {
    titleSelectors: ['textarea[placeholder*="请输入标题"]', 'textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
    contentSelectors: ['div[data-contents="true"]', ".public-DraftEditor-content", ".ProseMirror"],
    summarySelectors: [],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["保存", "存草稿"],
    publishTexts: ["发布"],
    aiTexts: ["包含 AI", "AI 辅助", "AI辅助"],
    originalTexts: [],
    firstTexts: [],
    exclusiveTexts: [],
  },
  qiehao: {
    titleSelectors: ['span[data-placeholder*="请输入标题"]', "#omEditorTitle [contenteditable='true']", 'input[placeholder*="标题"]'],
    contentSelectors: ['div.ProseMirror[contenteditable="true"]', ".ProseMirror", ".ql-editor"],
    summarySelectors: ['textarea[placeholder*="摘要"]'],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["存草稿", "保存"],
    publishTexts: ["发表", "发布"],
    aiTexts: ["生成合成", "AI生成", "人工智能生成"],
    originalTexts: ["原创"],
    firstTexts: [],
    exclusiveTexts: ["独家"],
  },
  baijiahao: {
    titleSelectors: ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
    contentSelectors: [".ql-editor", ".ProseMirror", ".public-DraftEditor-content", 'div[data-contents="true"]'],
    summarySelectors: ['textarea[placeholder*="摘要"]'],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["存草稿", "保存"],
    publishTexts: ["发布", "发表"],
    aiTexts: ["生成合成", "AI生成", "创作声明"],
    originalTexts: ["原创"],
    firstTexts: ["首发"],
    exclusiveTexts: [],
  },
  weixin: {
    titleSelectors: ["#title", 'input[placeholder*="标题"]', "#js_title"],
    contentSelectors: ["#ueditor_0", "iframe.edui-editor-iframeholder iframe", ".edui-editor iframe"],
    summarySelectors: ["#js_description", 'textarea[placeholder*="摘要"]', "#digest"],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["保存", "保存草稿"],
    publishTexts: ["发表", "群发"],
    aiTexts: ["生成合成", "AI生成"],
    originalTexts: [],
    firstTexts: [],
    exclusiveTexts: [],
  },
  csdn: {
    titleSelectors: ['input[placeholder*="标题"]', ".article-bar__title", "#txtTitle"],
    contentSelectors: [".ck-editor__editable", ".editor__inner", ".ProseMirror"],
    summarySelectors: ['textarea[placeholder*="摘要"]'],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["保存草稿", "存草稿"],
    publishTexts: ["发布文章", "发布"],
    aiTexts: ["AI生成", "生成合成"],
    originalTexts: ["原创"],
    firstTexts: [],
    exclusiveTexts: [],
  },
  juejin: {
    titleSelectors: ['input[placeholder*="输入文章标题"]', 'input[placeholder*="标题"]'],
    contentSelectors: [".CodeMirror", "div.CodeMirror-code[role='presentation']", ".bytemd-editor textarea", ".cm-content", ".cm-editor"],
    summarySelectors: [],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["保存草稿", "草稿"],
    publishTexts: ["发布"],
    aiTexts: [],
    originalTexts: [],
    firstTexts: [],
    exclusiveTexts: [],
  },
  cnblogs: {
    titleSelectors: ["#post-title", "#Editor_Edit_EditorBody_title", 'input[name="Title"]'],
    contentSelectors: [".tox-edit-area iframe", "#Editor_Edit_EditorBody_EditorBody", ".mce-content-body"],
    summarySelectors: ["#post-desc", "textarea.summary"],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["保存", "存为草稿"],
    publishTexts: ["发布"],
    aiTexts: [],
    originalTexts: [],
    firstTexts: [],
    exclusiveTexts: [],
  },
  bilibili: {
    titleSelectors: ['input[placeholder*="标题"]', "input.title"],
    contentSelectors: [".ql-editor", ".ProseMirror"],
    summarySelectors: ['textarea[placeholder*="简介"]', 'textarea[placeholder*="摘要"]'],
    coverInputSelectors: ['input[type="file"]'],
    openTexts: [],
    draftTexts: ["保存", "存草稿"],
    publishTexts: ["提交", "发布"],
    aiTexts: ["AI生成", "生成合成", "人工智能"],
    originalTexts: [],
    firstTexts: [],
    exclusiveTexts: [],
  },
  baike: {
    titleSelectors: [],
    contentSelectors: [],
    summarySelectors: [],
    coverInputSelectors: [],
    openTexts: [],
    draftTexts: [],
    publishTexts: [],
    aiTexts: [],
    originalTexts: [],
    firstTexts: [],
    exclusiveTexts: [],
  },
  website: {
    titleSelectors: [],
    contentSelectors: [],
    summarySelectors: [],
    coverInputSelectors: [],
    openTexts: [],
    draftTexts: [],
    publishTexts: [],
    aiTexts: [],
    originalTexts: [],
    firstTexts: [],
    exclusiveTexts: [],
  },
};

/**
 * 跑在页面 MAIN world，才能碰到 TinyMCE / CodeMirror / UEditor。
 * 子 frame 只填正文；顶层填标题/封面/声明。永不点官方发布。
 */
async function injectFill(arg: FillArg): Promise<FillResult> {
  const isTop = window.top === window;
  const startUrl = window.location.href;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const setNative = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    desc?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const looksLikeTitle = (el: Element): boolean => {
    const ph = `${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("data-placeholder") ?? ""}`;
    if (ph.includes("标题")) return true;
    const cls = typeof el.className === "string" ? el.className : "";
    return /title|publish-title|omEditorTitle/i.test(cls) || Boolean(el.closest(".publish-title, #omEditorTitle"));
  };

  const isVisibleBox = (el: Element): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 60 && r.height >= 24;
  };

  /** 按选择器顺序找正文，跳过标题框和过小的可编辑区域。 */
  const queryBest = (selectors: string[], forBody: boolean): Element | undefined => {
    for (const sel of selectors) {
      const hits = Array.from(document.querySelectorAll(sel)).filter((el) => {
        if (!isVisibleBox(el) && !(el instanceof HTMLIFrameElement)) return false;
        if (forBody && looksLikeTitle(el)) return false;
        return true;
      }) as HTMLElement[];
      if (!hits.length) continue;
      hits.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
      return hits[0];
    }
    return undefined;
  };

  const queryFirst = (selectors: string[]): Element | undefined => queryBest(selectors, false);

  const waitEl = async (selectors: string[], ms: number, forBody = false): Promise<Element | undefined> => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const el = queryBest(selectors, forBody);
      if (el) return el;
      await sleep(250);
    }
    return undefined;
  };

  const fillTextControl = (el: Element, value: string): boolean => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNative(el, value);
      return true;
    }
    const box = el as HTMLElement;
    box.focus();
    box.textContent = value;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return (box.innerText || "").trim().length > 0;
  };

  const pasteHtml = (el: HTMLElement, html: string): void => {
    el.focus();
    try {
      const dt = new DataTransfer();
      dt.setData("text/html", html);
      dt.setData("text/plain", arg.markdown || "");
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      el.dispatchEvent(paste);
    } catch {
      el.innerHTML = html;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  const filesFrom = (images: PackedImage[]): File[] =>
    images.map((img) => {
      const raw = atob(img.base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      return new File([bytes], img.filename, { type: img.mimeType });
    });

  /** 同源 iframe 里才有封面弹窗 / 确认层。 */
  const eachDoc = (fn: (doc: Document) => void): void => {
    const visit = (doc: Document) => {
      fn(doc);
      for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
        try {
          const inner = (frame as HTMLIFrameElement).contentDocument;
          if (inner) visit(inner);
        } catch {
          /* 跨域 frame 忽略 */
        }
      }
    };
    visit(document);
  };

  /** 有盒模型即可点；封面 overlay 常是 opacity:0，不能当隐藏。 */
  const isShown = (el: HTMLElement): boolean => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
  };

  const visibleClickable = (el: HTMLElement): boolean => {
    if (!isShown(el)) return false;
    return Number(getComputedStyle(el).opacity) !== 0;
  };

  const navish = (el: HTMLElement): boolean =>
    Boolean(el.closest("aside, nav, [class*='sidebar'], [class*='menu-ic'], [class*='sider-menu']"));

  const labelOf = (el: HTMLElement): string =>
    `${el.textContent ?? ""} ${el instanceof HTMLInputElement ? el.value : ""}`.replace(/\s+/g, "");

  const matchLabel = (raw: string, needles: string[], mode: "exact" | "includes"): boolean => {
    if (!raw || raw.length > 24) return false;
    if (/发布图文|发布视频|写文章/.test(raw) && !needles.some((n) => n.includes("图文"))) return false;
    return needles.some((n) => (mode === "exact" ? raw === n : raw.includes(n)));
  };

  /** React/Vue 认原生 click，不认 new Event("click")。内部 span 要点到可点祖先。 */
  const nativeClick = (el: HTMLElement): void => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const target = (el.closest("button, [role='button'], li.positive-button, a, input") as HTMLElement | null) ?? el;
    target.click();
  };

  const isEnabled = (el: HTMLElement): boolean => {
    if (el instanceof HTMLButtonElement && el.disabled) return false;
    if (el instanceof HTMLInputElement && el.disabled) return false;
    if (el.getAttribute("disabled") != null) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    if (el.classList.contains("disabled") || el.classList.contains("is-disabled")) return false;
    return visibleClickable(el) && !navish(el);
  };

  const waitEnabled = async (el: HTMLElement, timeoutMs: number): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (isEnabled(el)) return true;
      await sleep(200);
    }
    return isEnabled(el);
  };

  const clickText = (texts: string[]): boolean => {
    if (!texts.length) return false;
    const needles = texts.map((x) => x.replace(/\s+/g, ""));
    let hit: HTMLElement | undefined;
    eachDoc((doc) => {
      if (hit) return;
      const nodes = Array.from(doc.querySelectorAll("button, a, span, div, label, li")) as HTMLElement[];
      for (const el of nodes) {
        if (navish(el) || !visibleClickable(el)) continue;
        const t = (el.textContent ?? "").replace(/\s+/g, "");
        if (!t || t.length > 24) continue;
        if (needles.some((x) => t.includes(x))) {
          hit = el;
          return;
        }
      }
    });
    hit?.click();
    return Boolean(hit);
  };

  /**
   * 按官方左侧标签填搜索/输入类表单项（位置、来源等）。选填，失败不挡整篇。
   */
  const fillLabeledSearch = async (label: string, city: string): Promise<boolean> => {
    const q = city.trim();
    if (!q) return false;
    const compact = q.replace(/\s+/g, "");
    const labelCompact = label.replace(/\s+/g, "");

    let trigger: HTMLElement | undefined;
    eachDoc((doc) => {
      if (trigger) return;
      const nodes = Array.from(doc.querySelectorAll("div, span, p, label, button, input")) as HTMLElement[];
      for (const el of nodes) {
        if (navish(el) || !isShown(el)) continue;
        const ph = `${(el as HTMLInputElement).placeholder ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
        const t = (el.innerText ?? el.textContent ?? "").replace(/\s+/g, "");
        if (/标记城市|同城用户/.test(ph) || (t.length <= 40 && /标记城市|同城用户/.test(t))) {
          trigger = el;
          return;
        }
      }
      for (const el of nodes) {
        if (navish(el) || !isShown(el)) continue;
        const t = (el.innerText ?? "").replace(/\s+/g, "");
        if (t !== labelCompact && t !== "添加位置" && t !== "位置") continue;
        const row = el.closest("[class*='form'], [class*='item'], [class*='row']") as HTMLElement | null;
        const box = row?.querySelector(
          "input, [class*='select'], [class*='picker'], [role='combobox']",
        ) as HTMLElement | null;
        trigger = box && isShown(box) ? box : el;
        return;
      }
    });
    if (!trigger) return false;
    nativeClick(trigger);
    await sleep(450);

    let box: HTMLInputElement | undefined;
    eachDoc((doc) => {
      if (box) return;
      const inputs = Array.from(doc.querySelectorAll("input")) as HTMLInputElement[];
      box = inputs.find((i) => {
        if (i.type === "file" || i.type === "checkbox" || i.type === "radio" || i.type === "hidden") return false;
        if (!isShown(i)) return false;
        const ph = `${i.placeholder ?? ""}${i.getAttribute("aria-label") ?? ""}${i.getAttribute("name") ?? ""}`;
        return /城市|位置|搜索|同城|标记|poi|location/i.test(ph);
      });
      if (box) return;
      box = inputs.find((i) => {
        if (i.type === "file" || i.type === "checkbox" || i.type === "radio" || i.type === "hidden") return false;
        if (!isShown(i) || looksLikeTitle(i)) return false;
        const r = i.getBoundingClientRect();
        return r.width > 100 && r.height < 48;
      });
    });
    if (!box) {
      clickText([q]);
      return true;
    }
    box.focus();
    setNative(box, q);
    box.dispatchEvent(new KeyboardEvent("keyup", { key: compact.slice(-1) || "a", bubbles: true }));
    await sleep(700);

    let option: HTMLElement | undefined;
    eachDoc((doc) => {
      if (option) return;
      const items = Array.from(
        doc.querySelectorAll("[role='option'], li, [class*='option'], [class*='suggest'], [class*='item']"),
      ) as HTMLElement[];
      option = items.find((n) => {
        if (!isShown(n) || navish(n)) return false;
        const t = (n.innerText ?? "").replace(/\s+/g, "");
        return Boolean(t) && t.length <= 40 && t.includes(compact);
      });
    });
    if (option) {
      nativeClick(option);
      return true;
    }
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    box.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    return true;
  };

  const fillExtras = async (): Promise<void> => {
    for (const [label, raw] of Object.entries(arg.extras ?? {})) {
      const value = raw.trim();
      if (!value) continue;
      const ok = await fillLabeledSearch(label, value);
      if (!ok) clickText([value]);
    }
  };

  /**
   * 整词匹配可点节点。国内后台大量用 div/span，不能只扫 button。
   * 多个同名「发布」时优先真实按钮、再优先更靠页脚的，避开顶栏/侧栏导航。
   */
  const clickExact = (texts: string[]): boolean => {
    if (!texts.length) return false;
    const needles = texts.map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    const candidates: HTMLElement[] = [];
    eachDoc((doc) => {
      const nodes = Array.from(doc.querySelectorAll("button, [role='button'], a, span, div, label, h3")) as HTMLElement[];
      for (const needle of needles) {
        for (const el of nodes) {
          if (navish(el) || !visibleClickable(el)) continue;
          if (el.tagName === "A") {
            const href = (el as HTMLAnchorElement).href || "";
            const label = (el.textContent ?? "").replace(/\s+/g, "");
            if (/图文|视频/.test(label) && /publish|contentManagement|graphic/.test(href + label)) continue;
          }
          const t = (el.textContent ?? "").replace(/\s+/g, "");
          if (t === needle) candidates.push(el);
        }
      }
    });
    candidates.sort((a, b) => {
      const rank = (el: HTMLElement) => (el.tagName === "BUTTON" || el.getAttribute("role") === "button" ? 0 : 1);
      const byTag = rank(a) - rank(b);
      if (byTag) return byTag;
      return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
    });
    const hit = candidates[0];
    hit?.click();
    return Boolean(hit);
  };

  /** 确认发布几乎都在弹层里；找不到 dialog 就不要满页扫短词。 */
  const clickInDialog = (texts: string[]): boolean => {
    if (!texts.length) return false;
    const needles = texts.map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    let hit: HTMLElement | undefined;
    eachDoc((doc) => {
      if (hit) return;
      const dialogs = Array.from(
        doc.querySelectorAll(
          "[role='dialog'], [class*='modal'], [class*='dialog'], [class*='confirm'], [class*='popup'], .ant-modal, .el-dialog, .el-message-box, .el-overlay"
        )
      );
      for (const root of dialogs) {
        const nodes = Array.from(root.querySelectorAll("button, [role='button'], a, span, div, label")) as HTMLElement[];
        for (const needle of needles) {
          const el = nodes.find((n) => {
            const t = (n.textContent ?? "").replace(/\s+/g, "");
            if (!t || t.length > 24) return false;
            return t === needle || (needle.length >= 4 && t.includes(needle));
          });
          if (el) {
            hit = el;
            return;
          }
        }
      }
    });
    hit?.click();
    return Boolean(hit);
  };

  /**
   * 创作声明必须点 checkbox/radio 外壳，不能扫全文「AI」。
   * 对齐 toutiao-publish / MatrixMedia：按 [role=checkbox] 文案匹配，已勾的不要再点。
   * 头条同一行有「引用站内 / 引用AI」，父节点 innerText 会把两个词拼在一起，includes 会误点站内引用。
   */
  const FLAG_SEL =
    "input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='radio'], [role='switch'], label, .byte-checkbox, .byte-checkbox-wrapper, .byte-radio, .byte-radio-wrapper, .ant-checkbox-wrapper, .el-checkbox, .el-switch, .omui-checkbox, .cheetah-radio-wrapper, [class*='checkbox'], [class*='radio'], [class*='switch']";

  /** 这些是互斥选项，点中会弹出必填「站内来源账号」。 */
  const DECLARE_BAN = ["引用站内", "取材网络", "同时发布", "微头条", "虚构演绎", "投资观点", "健康医疗", "添加站内来源"];
  const DECLARE_OPTIONS = ["引用AI", "引用站内", "取材网络", "个人观点", "虚构演绎", "投资观点", "健康医疗", "同时发布"];

  const controlLabel = (el: HTMLElement): string => {
    const wrap = el.closest(
      "label, [role='checkbox'], [role='radio'], .byte-checkbox-wrapper, .byte-radio-wrapper, .ant-checkbox-wrapper",
    ) as HTMLElement | null;
    const aria = (el.getAttribute("aria-label") ?? "").replace(/\s+/g, "");
    const self = (el.textContent ?? "").replace(/\s+/g, "");
    const wrapText = wrap && wrap !== el ? (wrap.innerText ?? "").replace(/\s+/g, "") : "";
    const next = el.nextElementSibling instanceof HTMLElement ? (el.nextElementSibling.innerText ?? "").replace(/\s+/g, "") : "";
    // 只用单选项短文案；整组「取材网络引用站内…引用AI」会误匹配。
    const parts = [aria, self.length <= 24 ? self : "", wrapText.length <= 24 ? wrapText : "", next.length <= 24 ? next : ""];
    return parts.join("").replace(/\s+/g, "");
  };

  const isDeclareGroup = (el: HTMLElement, t: string): boolean => {
    const nested = el.querySelectorAll("input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='radio']");
    if (nested.length > 1) return true;
    return DECLARE_OPTIONS.filter((n) => t.includes(n)).length > 1;
  };

  const isOn = (el: HTMLElement): boolean => {
    if (el instanceof HTMLInputElement) return el.checked;
    if (el.getAttribute("aria-checked") === "true") return true;
    if (/checked|is-checked|is-selected|is-opened|switch-on|byte-checkbox-checked|ant-checkbox-checked|el-switch-checked/.test(el.className)) return true;
    const input = el.querySelector("input[type='checkbox'], input[type='radio']") as HTMLInputElement | null;
    if (input?.checked) return true;
    const host = el.closest("[role='checkbox'], [role='radio']");
    return host?.getAttribute("aria-checked") === "true";
  };

  const labelHits = (t: string, needle: string): boolean => {
    if (!t || !needle) return false;
    if (DECLARE_BAN.some((b) => t.includes(b))) return false;
    if (needle === "引用AI") return t.includes("引用AI") && !t.includes("站内");
    return t === needle || t.includes(needle);
  };

  const setCheckedByLabel = (needles: string[]): boolean => {
    if (!needles.length) return false;
    const norms = needles.map((x) => x.replace(/\s+/g, "")).filter((x) => x.length >= 2);
    const candidates: HTMLElement[] = [];
    eachDoc((doc) => {
      for (const node of Array.from(doc.querySelectorAll(FLAG_SEL)) as HTMLElement[]) {
        if (navish(node)) continue;
        const st = getComputedStyle(node);
        if (st.display === "none" || st.visibility === "hidden") continue;
        const t = controlLabel(node);
        if (!t || t.length > 40) continue;
        if (t === "作品声明" || t === "创作声明" || t === "内容声明") continue;
        if (isDeclareGroup(node, t)) continue;
        if (!norms.some((n) => labelHits(t, n))) continue;
        candidates.push(node);
      }
    });
    candidates.sort((a, b) => {
      const rank = (el: HTMLElement) => {
        if (el instanceof HTMLInputElement) return 0;
        if (el.getAttribute("role") === "checkbox" || el.getAttribute("role") === "radio") return 1;
        if (el.tagName === "LABEL") return 2;
        return 3;
      };
      const byTag = rank(a) - rank(b);
      if (byTag) return byTag;
      return controlLabel(a).length - controlLabel(b).length;
    });
    let already = false;
    for (const el of candidates) {
      if (isOn(el)) {
        already = true;
        continue;
      }
      nativeClick(el);
      return true;
    }
    return already;
  };

  /** 误勾「引用站内」会弹出必填账号，必须点掉。同一选项可能命中 input+label，只点一次。 */
  const uncheckByLabel = (needles: string[]): boolean => {
    const norms = needles.map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    const hits: HTMLElement[] = [];
    eachDoc((doc) => {
      for (const node of Array.from(doc.querySelectorAll(FLAG_SEL)) as HTMLElement[]) {
        if (navish(node)) continue;
        const t = controlLabel(node);
        if (!norms.some((n) => t === n || t.includes(n))) continue;
        if (isDeclareGroup(node, t)) continue;
        if (!isOn(node)) continue;
        hits.push(node);
      }
    });
    hits.sort((a, b) => {
      const rank = (el: HTMLElement) => (el instanceof HTMLInputElement || el.getAttribute("role") === "checkbox" ? 0 : 1);
      return rank(a) - rank(b);
    });
    const seen = new Set<string>();
    let did = false;
    for (const node of hits) {
      const t = controlLabel(node);
      if (seen.has(t)) continue;
      seen.add(t);
      nativeClick(node);
      did = true;
    }
    return did;
  };

  /** 搜狐声明经常是开关旁边一行字，控件本身没有文案。 */
  const setCheckedByNearbyText = (needles: string[]): boolean => {
    if (!needles.length) return false;
    const norms = needles.map((x) => x.replace(/\s+/g, "")).filter((x) => x.length >= 2);
    let clicked = false;
    eachDoc((doc) => {
      if (clicked) return;
      const nodes = Array.from(doc.querySelectorAll("span, label, div, p, li, em, i")) as HTMLElement[];
      for (const el of nodes) {
        if (navish(el)) continue;
        const t = (el.textContent ?? "").replace(/\s+/g, "");
        if (t.length < 2 || t.length > 40) continue;
        if (DECLARE_OPTIONS.filter((n) => t.includes(n)).length > 1) continue;
        if (DECLARE_BAN.some((b) => t.includes(b))) continue;
        if (!norms.some((n) => t.includes(n))) continue;
        const host = (el.closest("label, li, .form-item, [class*='form'], [class*='declare']") as HTMLElement | null) ?? el.parentElement;
        const ctrl = host?.querySelector(
          "input[type='checkbox'], input[type='radio'], [role='checkbox'], [role='switch'], [class*='switch']",
        ) as HTMLElement | null;
        const target = ctrl ?? (el.previousElementSibling as HTMLElement | null) ?? el;
        if (!(target instanceof HTMLElement)) continue;
        if (isOn(target)) {
          clicked = true;
          return;
        }
        nativeClick(target);
        clicked = true;
        return;
      }
    });
    return clicked;
  };

  /** 填完正文后再勾；预览弹层里也可能再出一次声明。 */
  const setDeclarations = async (): Promise<boolean> => {
    clickExact(["作品声明", "创作声明", "内容声明", "添加声明", "内容标识", "更多设置"]);
    await sleep(400);
    let ok = !arg.aiDeclared;
    const start = Date.now();
    while (Date.now() - start < 3500) {
      if (arg.platform === "toutiao") {
        // 先清掉站内引用，再只勾「引用AI」和「个人观点」。
        uncheckByLabel(["引用站内"]);
        if (arg.aiDeclared) ok = setCheckedByLabel(["引用AI"]) || ok;
        setCheckedByLabel(["个人观点"]);
        uncheckByLabel(["引用站内"]);
      } else if (arg.aiDeclared) {
        const extraAi = ["引用AI", "引用 AI", "AI生成", "生成合成", "生成式人工智能", "包含AI", "AI辅助", "内容标识", "AIGC", "合成内容", "人工智能生成"];
        if (setCheckedByLabel([...arg.aiTexts, ...extraAi])) ok = true;
        if (!ok) ok = setCheckedByNearbyText([...arg.aiTexts, ...extraAi]);
      }
      if (arg.claimOriginal) setCheckedByLabel(arg.originalTexts);
      if (arg.claimFirstPublish) setCheckedByLabel(arg.firstTexts);
      if (arg.claimExclusive) setCheckedByLabel(arg.exclusiveTexts);
      if (ok) break;
      await sleep(250);
    }
    if (arg.platform === "toutiao") uncheckByLabel(["引用站内"]);
    return ok;
  };

  const clickSel = (selectors: string[]): boolean => {
    if (!selectors.length) return false;
    let hit: HTMLElement | undefined;
    eachDoc((doc) => {
      if (hit) return;
      for (const s of selectors) {
        const els = Array.from(doc.querySelectorAll(s)).filter((el): el is HTMLElement => el instanceof HTMLElement);
        const el = els.find((n) => !navish(n) && isShown(n));
        if (el) {
          hit = el;
          return;
        }
      }
    });
    if (hit) nativeClick(hit);
    return Boolean(hit);
  };

  /** 封面入口经常是小图标/半透明层，不能用可见性过滤。 */
  const clickSelLoose = (selectors: string[]): boolean => {
    if (!selectors.length) return false;
    let hit: HTMLElement | undefined;
    eachDoc((doc) => {
      if (hit) return;
      for (const s of selectors) {
        const el = doc.querySelector(s);
        if (el instanceof HTMLElement && !navish(el)) {
          hit = el;
          return;
        }
      }
    });
    if (hit) nativeClick(hit);
    return Boolean(hit);
  };

  const DIALOG_SEL =
    "[role='dialog'], [class*='modal'], [class*='dialog'], [class*='confirm'], [class*='popup'], .ant-modal, .el-dialog, .el-message-box, .el-overlay, .byte-modal, .semi-modal, .arco-modal";

  const collectBySelectors = (selectors: string[]): HTMLElement[] => {
    const out: HTMLElement[] = [];
    if (!selectors.length) return out;
    eachDoc((doc) => {
      for (const s of selectors) {
        for (const node of Array.from(doc.querySelectorAll(s))) {
          if (node instanceof HTMLElement) out.push(node);
        }
      }
    });
    return out;
  };

  const rankPublish = (a: HTMLElement, b: HTMLElement): number => {
    const rank = (el: HTMLElement) =>
      el.tagName === "BUTTON" || el.tagName === "INPUT" || el.getAttribute("role") === "button" || el.tagName === "LI" ? 0 : 1;
    const byTag = rank(a) - rank(b);
    if (byTag) return byTag;
    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
  };

  /**
   * 平台专用选择器 + fallbackTags。不扫裸 div/span。
   * disabled 的按钮先收下，后面 waitEnabled。
   */
  const findPublishButton = (): HTMLElement | undefined => {
    const needles = arg.actionPublishTexts.map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    if (!needles.length) return undefined;
    const mode = arg.matchMode;
    const seen = new Set<HTMLElement>();
    const take = (nodes: HTMLElement[]): HTMLElement[] => {
      const hits: HTMLElement[] = [];
      for (const el of nodes) {
        if (seen.has(el) || navish(el)) continue;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || r.width < 8 || r.height < 8) continue;
        if (!matchLabel(labelOf(el), needles, mode)) continue;
        seen.add(el);
        hits.push(el);
      }
      return hits;
    };
    let candidates = take(collectBySelectors(arg.publishSelectors));
    if (!candidates.length && arg.fallbackTags) {
      const extra: HTMLElement[] = [];
      eachDoc((doc) => {
        extra.push(...(Array.from(doc.querySelectorAll(arg.fallbackTags)) as HTMLElement[]));
      });
      candidates = take(extra);
    }
    candidates.sort(rankPublish);
    return candidates[0];
  };

  const findDraftButton = (): HTMLElement | undefined => {
    const needles = arg.draftTexts.map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    if (!needles.length) return undefined;
    const hits: HTMLElement[] = [];
    eachDoc((doc) => {
      const nodes = Array.from(doc.querySelectorAll("button, [role='button']")) as HTMLElement[];
      for (const el of nodes) {
        if (navish(el) || !isShown(el)) continue;
        if (matchLabel(labelOf(el), needles, "exact")) hits.push(el);
      }
    });
    hits.sort(rankPublish);
    return hits[0];
  };

  const dialogOpen = (): boolean => {
    let open = false;
    eachDoc((doc) => {
      const nodes = Array.from(doc.querySelectorAll(DIALOG_SEL)) as HTMLElement[];
      if (nodes.some((n) => isShown(n))) open = true;
    });
    return open;
  };

  const clickConfirm = async (): Promise<boolean> => {
    const needles = arg.confirmTexts.map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    if (!needles.length && !arg.confirmSelectors.length) return true;

    /** 先专用选择器，再全页 button。不能只搜 dialog：页面上 [class*=confirm] 很多是假弹层。 */
    const publishNeedles = arg.actionPublishTexts.map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    const isFirstPublish = (el: HTMLElement) =>
      publishNeedles.length > 0 && matchLabel(labelOf(el), publishNeedles, arg.matchMode);

    const tryOnce = (): HTMLElement | undefined => {
      const pool: HTMLElement[] = [];
      for (const el of collectBySelectors(arg.confirmSelectors)) {
        if (navish(el) || !isShown(el) || isFirstPublish(el)) continue;
        // 有确认文案时，选择器命中也必须对得上，避免把「预览并发布」再点一遍。
        if (needles.length && !matchLabel(labelOf(el), needles, "includes")) continue;
        pool.push(el);
      }
      if (needles.length) {
        eachDoc((doc) => {
          const nodes = Array.from(doc.querySelectorAll("button, [role='button']")) as HTMLElement[];
          for (const n of nodes) {
            if (navish(n) || !isShown(n) || isFirstPublish(n)) continue;
            if (matchLabel(labelOf(n), needles, "includes")) pool.push(n);
          }
        });
      }
      const unique = [...new Set(pool)];
      const enabled = unique.filter((el) => isEnabled(el));
      const pick = (enabled.length ? enabled : unique).slice().sort(rankPublish);
      return pick[0];
    };

    const start = Date.now();
    while (Date.now() - start < Math.max(arg.enabledTimeoutMs, 8000) + 2000) {
      const el = tryOnce();
      if (el && isEnabled(el)) {
        nativeClick(el);
        return true;
      }
      if (el) {
        const ready = await waitEnabled(el, 1200);
        if (ready) {
          nativeClick(el);
          return true;
        }
      }
      await sleep(250);
    }
    return false;
  };

  /** 封面弹窗「确定」可能先是 disabled，空点等于没点。 */
  const clickCoverConfirm = async (): Promise<boolean> => {
    if (!arg.coverConfirmSelectors.length) return false;
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const nodes = collectBySelectors(arg.coverConfirmSelectors);
      const el = nodes.find((n) => {
        if (navish(n) || !isShown(n)) return false;
        const t = labelOf(n);
        if (t.includes("发布")) return false;
        return !t || t.includes("确定") || t.includes("确认");
      });
      if (el && (await waitEnabled(el, 5000))) {
        nativeClick(el);
        return true;
      }
      await sleep(200);
    }
    return false;
  };

  const asFileInput = (el: Element | null | undefined): HTMLInputElement | undefined => {
    if (!el) return undefined;
    if (el instanceof HTMLInputElement && (el.type === "file" || el.id === "new-file")) return el;
    if (el instanceof HTMLLabelElement) {
      const target = el.htmlFor ? el.ownerDocument.getElementById(el.htmlFor) : el.querySelector('input[type="file"]');
      if (target instanceof HTMLInputElement) return target;
    }
    const inner = el.querySelector?.('input[type="file"]');
    return inner instanceof HTMLInputElement ? inner : undefined;
  };

  const isEditorToolInput = (el: Element): boolean =>
    Boolean(el.closest(".ql-toolbar, .ql-formats, .ql-image, [class*='toolbar'], .ProseMirror, .ql-editor"));

  const visibleDialogs = (): HTMLElement[] => {
    const preferred: HTMLElement[] = [];
    const fallback: HTMLElement[] = [];
    eachDoc((doc) => {
      for (const n of Array.from(doc.querySelectorAll(DIALOG_SEL)) as HTMLElement[]) {
        if (!isShown(n)) continue;
        const role = n.getAttribute("role") ?? "";
        const cls = typeof n.className === "string" ? n.className : "";
        if (role === "dialog" || /byte-modal|semi-modal|arco-modal|ant-modal|el-dialog/i.test(cls)) {
          preferred.push(n);
        } else {
          fallback.push(n);
        }
      }
    });
    return preferred.length ? preferred : fallback;
  };

  const pickCoverInputIn = (root: ParentNode, selectors: string[], allowFirstImage: boolean): HTMLInputElement | undefined => {
    const byId = asFileInput(
      root instanceof Element || root instanceof Document
        ? root.querySelector("#new-file, input#new-file, label[for='new-file']")
        : null,
    );
    if (byId && !isEditorToolInput(byId)) return byId;
    for (const s of selectors) {
      if (s === 'input[type="file"]') continue;
      const hit = asFileInput(root.querySelector(s));
      if (hit && !isEditorToolInput(hit)) return hit;
    }
    const files = Array.from(root.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    const imageish = files.filter((el) => {
      if (isEditorToolInput(el)) return false;
      const acc = (el.accept || "").toLowerCase();
      return !acc || acc.includes("image") || acc.includes("*") || acc.includes("png") || acc.includes("jpeg");
    });
    const nearCover = imageish.find((el) => {
      const ctx = `${el.id} ${el.name} ${el.className} ${el.closest("[class]")?.className ?? ""}`;
      return /cover|thumb|封面|new-file|upload/i.test(ctx);
    });
    if (nearCover) return nearCover;
    // 弹层里的第一个图片 input 才敢用；整页乱抓会命中正文插图。
    return allowFirstImage ? imageish[0] : undefined;
  };

  const findCoverInput = (selectors: string[]): HTMLInputElement | undefined => {
    let found: HTMLInputElement | undefined;
    eachDoc((doc) => {
      if (found) return;
      const byId = asFileInput(doc.querySelector("#new-file, input#new-file, label[for='new-file']"));
      if (byId && !isEditorToolInput(byId)) found = byId;
    });
    if (found) return found;
    const dialogs = visibleDialogs();
    if (dialogs.length) {
      for (const dlg of dialogs) {
        const hit = pickCoverInputIn(dlg, selectors, true);
        if (hit) return hit;
      }
      return undefined;
    }
    eachDoc((doc) => {
      if (found) return;
      found = pickCoverInputIn(doc, selectors, false);
    });
    return found;
  };

  const assignFiles = (input: HTMLInputElement, files: File[]): boolean => {
    if (!files.length) return false;
    const dt = new DataTransfer();
    // 只塞这一批，不要往已有 FileList 上追加。
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return Boolean(input.files?.length);
  };

  /**
   * 通用封面槽：只点空的添加块。头条图库里大量 [class*=cover]/thumb，乱点会一次勾几十张。
   */
  const clickCoverSlot = (): boolean => {
    if (arg.platform === "toutiao") return false;
    const slots: HTMLElement[] = [];
    eachDoc((doc) => {
      const nodes = Array.from(doc.querySelectorAll("[class*='cover'], [class*='Cover']")) as HTMLElement[];
      for (const el of nodes) {
        if (navish(el) || el.closest(".ql-toolbar, [class*='toolbar']")) continue;
        if (el.tagName === "IMG" || el.closest("img")) continue;
        const t = (el.textContent ?? "").replace(/\s+/g, "");
        if (t.length > 16) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 48 || r.height < 48) continue;
        slots.push(el);
      }
    });
    slots.sort((a, b) => {
      const area = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height;
      };
      return area(b) - area(a);
    });
    const hit = slots[0];
    hit?.click();
    return Boolean(hit);
  };

  /** 门户后台封面上限通常 2MB；5MB PNG 塞进去也会被拒。 */
  const compressCover = async (file: File): Promise<File> => {
    if (file.size < 1_200_000 && /jpeg|jpg/i.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file);
      const maxW = 1280;
      const scale = Math.min(1, maxW / Math.max(bmp.width, 1));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      bmp.close();
      if (!blob || blob.size < 32) return file;
      return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
    } catch {
      return file;
    }
  };

  /** 头条残留封面槽会叠上去；只清删除按钮，绝不点图库缩略图。 */
  const clearOldCovers = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) {
      let del: HTMLElement | undefined;
      eachDoc((doc) => {
        if (del) return;
        const n = doc.querySelector(".article-cover-delete, [class*='cover-delete']");
        if (n instanceof HTMLElement && isShown(n)) del = n;
      });
      if (!del) break;
      nativeClick(del);
      await sleep(150);
    }
  };

  const switchCoverTab = (): void => {
    if (!arg.coverTabTexts.length) return;
    if (arg.platform === "toutiao") {
      let tab: HTMLElement | undefined;
      eachDoc((doc) => {
        if (tab) return;
        const nodes = Array.from(doc.querySelectorAll("div.byte-tabs-header-title, [class*='tabs-header']")) as HTMLElement[];
        tab = nodes.find((n) => (n.textContent ?? "").replace(/\s+/g, "") === "上传图片");
      });
      if (tab) {
        nativeClick(tab);
        return;
      }
    }
    clickExact(arg.coverTabTexts) || clickText(arg.coverTabTexts);
  };

  const attachFiles = async (selectors: string[], images: PackedImage[]): Promise<boolean> => {
    if (!images.length) return false;
    const maxCount = Math.max(1, Math.min(arg.coverMaxCount || 1, 3));
    const files = (await Promise.all(filesFrom(images).map((f) => compressCover(f)))).slice(0, maxCount);
    if (arg.platform === "toutiao") {
      await clearOldCovers();
      clickExact(["单图"]);
      await sleep(250);
    }
    let opened = 0;
    const openCover = () => {
      if (opened >= 2) return;
      opened += 1;
      clickSelLoose(arg.coverOpenSelectors);
      if (arg.platform === "toutiao") return;
      clickExact(["添加封面", "上传封面", "设置封面", "选择封面", "点击上传"]);
      if (opened === 1) clickCoverSlot();
    };
    openCover();
    await sleep(arg.coverOpenSelectors.length ? 900 : 400);
    switchCoverTab();
    await sleep(500);
    const start = Date.now();
    const budget = arg.coverRequired ? 10000 : 6000;
    let assigned = false;
    while (Date.now() - start < budget) {
      const input = findCoverInput(selectors);
      if (input && !assigned && assignFiles(input, files)) {
        assigned = true;
        // 搜狐弹窗要等缩略图出来再点确定，立刻点等于没传。
        await sleep(arg.platform === "sohu" ? 4000 : 1000);
        await clickCoverConfirm();
        return true;
      }
      if (!assigned && opened < 2 && Date.now() - start > 2000) {
        openCover();
        await sleep(500);
        switchCoverTab();
      }
      await sleep(400);
    }
    if (arg.coverMustBeInBody) return pickCoverFromBody();
    return false;
  };

  /** 封面必须来自正文图时，点「从正文选择」再点第一张缩略图。 */
  const pickCoverFromBody = async (): Promise<boolean> => {
    clickExact(["从正文选择", "正文选图", "选择正文图片", "使用正文图片", "从正文选取"]);
    await sleep(700);
    let img: HTMLElement | undefined;
    eachDoc((doc) => {
      if (img) return;
      const roots = Array.from(doc.querySelectorAll("[role='dialog'], [class*='modal'], [class*='dialog'], [class*='cover']"));
      const search = roots.length ? roots : [doc.body];
      for (const root of search) {
        const hit = Array.from(root.querySelectorAll("img")).find((n) => {
          const r = n.getBoundingClientRect();
          return r.width >= 40 && r.height >= 40;
        });
        if (hit) {
          img = hit as HTMLElement;
          return;
        }
      }
    });
    img?.click();
    if (!img) return false;
    await sleep(400);
    clickInDialog(["确定", "确认", "完成", "使用"]);
    return true;
  };

  const pageHas = (needles: string[]): boolean => {
    if (!needles.length) return false;
    let hit = false;
    eachDoc((doc) => {
      const t = doc.body?.innerText ?? "";
      if (needles.some((n) => t.includes(n))) hit = true;
    });
    return hit;
  };

  /**
   * 用路径段判断是否还在写稿页。/edit/ 不能写成 /edit/i，否则会误伤 pathname 里的 editor。
   * hash SPA（网易号）也要比 hash。
   */
  const stillWriting = (href: string): boolean => {
    const path = (href.split("?")[0] ?? href).toLowerCase();
    const hashPart = href.split("#")[1] ?? "";
    const hash = (hashPart.split("?")[0] ?? "").toLowerCase();
    return /(^|\/)(addarticle|write|edit)(\/|$)|graphic\/publish|article\/articlepublish|#\/post\/article/i.test(`${path}#${hash}`);
  };

  const leftEditor = (fromUrl: string): boolean => {
    try {
      const hashNow = (location.hash.split("?")[0] ?? "").toLowerCase();
      const now = `${location.pathname}${hashNow}`.toLowerCase();
      const prev = new URL(fromUrl, location.origin);
      const hashThen = (prev.hash.split("?")[0] ?? "").toLowerCase();
      const then = `${prev.pathname}${hashThen}`.toLowerCase();
      if (now === then) return false;
      return !stillWriting(location.href);
    } catch {
      return false;
    }
  };

  /**
   * 只有成功 toast、离开写稿页、或「发布中」走完才算发出去。
   * 封面弹层开关不能当成功：头条图库关了不等于稿件已发。
   */
  const waitSuccess = async (
    needles: string[],
    ms: number,
    fromUrl: string,
    _opts?: { confirmed?: boolean; sawDialog?: { value: boolean } },
  ): Promise<boolean> => {
    if (!needles.length) return false;
    let sawBusy = false;
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (pageHas(needles)) return true;
      if (leftEditor(fromUrl)) return true;
      if (pageHas(["发布中", "提交中", "发表中", "处理中"])) sawBusy = true;
      else if (sawBusy) return true;
      await sleep(300);
    }
    return false;
  };

  const win = window as unknown as {
    tinymce?: { editors?: Array<{ setContent: (html: string) => void }>; activeEditor?: { setContent: (html: string) => void } };
    UE?: { getEditor?: (id: string) => { setContent: (html: string) => void } | undefined };
  };

  const fillBody = (root: Element): boolean => {
    const hasText = (s: string | undefined) => (s ?? "").replace(/\s/g, "").replace(/<[^>]+>/g, "").length > 10;
    const cmHost = root.classList?.contains("CodeMirror") ? root : root.querySelector?.(".CodeMirror");
    const cm = (cmHost as { CodeMirror?: { setValue: (v: string) => void; getValue?: () => string } } | null)?.CodeMirror;
    if (cm) {
      cm.setValue(arg.markdown || arg.html);
      return hasText(cm.getValue?.() || arg.markdown);
    }
    if (win.tinymce?.activeEditor) {
      win.tinymce.activeEditor.setContent(arg.html);
      return true;
    }
    if (win.tinymce?.editors?.[0]) {
      win.tinymce.editors[0].setContent(arg.html);
      return true;
    }
    const ue = win.UE?.getEditor?.("ueditor_0");
    if (ue) {
      ue.setContent(arg.html);
      return true;
    }
    if (root instanceof HTMLIFrameElement) {
      const doc = root.contentDocument;
      if (doc?.body) {
        doc.body.innerHTML = arg.html;
        doc.body.dispatchEvent(new Event("input", { bubbles: true }));
        return hasText(doc.body.innerText || doc.body.textContent || "");
      }
    }
    if (root instanceof HTMLTextAreaElement) {
      setNative(root, arg.markdown || arg.html);
      return hasText(root.value);
    }
    const box = root as HTMLElement;
    const before = (box.innerText || box.textContent || "").replace(/\s/g, "").length;
    pasteHtml(box, arg.html);
    if ((box.innerText || box.textContent || "").replace(/\s/g, "").length <= before) {
      box.innerHTML = arg.html;
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    }
    const got = (box.innerText || box.textContent || "").replace(/\s/g, "").length;
    return got > 10;
  };

  if (isTop && arg.openTexts.length) {
    const early = queryBest([...arg.titleSelectors, ...arg.contentSelectors], false);
    if (!early) {
      clickText(arg.openTexts);
      await sleep(1600);
    }
  }

  const titleEl = await waitEl(arg.titleSelectors, isTop ? 10000 : 2000, false);
  let filledTitle = false;
  if (titleEl) filledTitle = fillTextControl(titleEl, arg.title);

  const bodyEl = await waitEl(arg.contentSelectors, isTop ? 14000 : 5000, true);
  let filledBody = false;
  if (bodyEl) filledBody = fillBody(bodyEl);

  let filledSummary = false;
  if (arg.summary && arg.summarySelectors.length) {
    const sum = arg.summarySelectors.map((s) => document.querySelector(s)).find(Boolean) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | undefined;
    if (sum) {
      setNative(sum, arg.summary);
      filledSummary = true;
    }
  }

  if (isTop && arg.category) clickText([arg.category]);
  if (isTop) await fillExtras();
  let declaredAi = false;
  if (isTop) declaredAi = await setDeclarations();

  const attachedCover = isTop ? await attachFiles(arg.coverInputSelectors, arg.coverImages) : false;
  if (isTop && attachedCover) {
    await sleep(1000);
    await clickCoverConfirm();
  }
  if (isTop && arg.aiDeclared) declaredAi = (await setDeclarations()) || declaredAi;

  let clicked = false;
  let published = false;
  // 产品路径：只填标题/正文/封面/声明，不点官方发布。成功看填没填上。
  const dedicatedCoverUi = arg.coverOpenSelectors.length > 0;
  const coverBlocks = dedicatedCoverUi && arg.coverRequired && arg.coverImages.length > 0 && !attachedCover;
  const coverOk = !coverBlocks;

  if (!isTop) {
    if (!filledTitle && !filledBody) return { ok: false, message: "frame skip" };
    return { ok: true, message: "frame filled", filledTitle, filledBody, filledSummary, attachedCover };
  }

  if (!filledTitle && !filledBody) {
    return { ok: false, message: "未找到标题或正文编辑器，请在已打开页面手工粘贴。" };
  }
  if (!filledBody) {
    return {
      ok: false,
      filledTitle,
      filledBody: false,
      filledSummary,
      attachedCover,
      clicked: false,
      message: "已填标题；正文未填（没找到正文编辑器）。请在官方页手工粘贴正文后再保存。",
    };
  }
  if (arg.summaryRequired && arg.summary && !filledSummary) {
    return {
      ok: false,
      message: "摘要必填但未找到摘要框，已打开官方页请手工补摘要。",
      filledTitle,
      filledBody,
    };
  }
  if (coverBlocks) {
    return {
      ok: false,
      filledTitle,
      filledBody,
      filledSummary,
      attachedCover: false,
      declaredAi,
      clicked: false,
      message: [
        declaredAi ? "已勾创作声明" : arg.aiDeclared ? "创作声明未勾上" : "",
        "封面未挂上。已停在官方编辑器，请补封面后自己点发布。",
      ]
        .filter(Boolean)
        .join("；"),
    };
  }
  const fillMsg = coverOk
    ? "已填入官方编辑器，请核对后自己点发布"
    : "已填入编辑器，封面未挂上，请手工补图后点发布";
  return {
    ok: Boolean(filledBody && coverOk),
    filledTitle,
    filledBody,
    filledSummary,
    attachedCover,
    declaredAi,
    clicked,
    published,
    message: [
      filledTitle ? "已填标题" : "标题未填",
      filledBody ? "已填正文" : "正文未填",
      filledSummary ? "已填摘要" : "",
      attachedCover ? "已挂封面" : arg.coverImages.length ? "封面未挂上" : "",
      arg.aiDeclared ? (declaredAi ? "已勾创作声明" : "创作声明未勾上") : "",
      fillMsg,
    ]
      .filter(Boolean)
      .join("；"),
  };
}

function waitTab(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), 18000);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(t);
        setTimeout(resolve, 1600);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeResults(rows: Array<FillResult | undefined>): FillResult {
  const list = rows.filter((r): r is FillResult => Boolean(r) && r.message !== "frame skip");
  if (!list.length) return { ok: false, message: "脚本无返回" };
  const top = list.find((r) => r.message !== "frame filled") ?? list[0];
  const filledTitle = list.some((r) => r.filledTitle);
  const filledBody = list.some((r) => r.filledBody);
  const filledSummary = list.some((r) => r.filledSummary);
  const attachedCover = list.some((r) => r.attachedCover);
  const clicked = list.some((r) => r.clicked);
  const published = list.some((r) => r.published);
  // 正文填上了还不等于发出去；顶层封面必填失败必须保持失败。
  const ok = Boolean(filledBody && top?.ok);
  return {
    ok,
    filledTitle,
    filledBody,
    filledSummary,
    attachedCover,
    clicked,
    published,
    message: top?.message ?? "已尝试填表",
  };
}

export async function fillOfficialPage(url: string, target: PublishTarget): Promise<TaskResult> {
  if (target.platform === "baike" || target.platform === "website") {
    if (!url) return { platform: target.platform, ok: false, message: "未配置维护 URL" };
    await chrome.tabs.create({ url, active: true });
    return { platform: target.platform, ok: true, message: "已打开维护页，请按清单人工核对" };
  }
  // 微信 / B 站 / 百家号：保存稿件后跳编辑页，不走 DOM 点发布。
  if (isSaveDraftEditorPlatform(target.platform)) {
    return saveDraftThenOpenEditor(target);
  }
  const tab = await chrome.tabs.create({ url, active: true });
  if (!tab.id) return { platform: target.platform, ok: false, message: "无法打开标签页" };
  await waitTab(tab.id);
  // SPA 标题框先出来，Draft/Quill/ProseMirror 还要再等一轮。
  await sleep(2600);

  const sel = SELECTORS[target.platform];
  const coverUi = COVER_UI[target.platform];
  const actionUi = ACTION_UI[target.platform];
  const arg: FillArg = {
    title: target.title,
    html: target.html,
    markdown: target.markdown,
    summary: target.summary,
    category: target.category,
    tags: target.tags,
    extras: (() => {
      const extras = { ...(target.extras ?? {}) };
      if (target.location?.trim()) {
        const key = Object.keys(extras).find((k) => /位置/.test(k)) ?? "添加位置";
        if (!extras[key]) extras[key] = target.location.trim();
      }
      return extras;
    })(),
    mode: "draft",
    aiDeclared: target.aiDeclared,
    claimOriginal: target.claimOriginal,
    claimFirstPublish: target.claimFirstPublish,
    claimExclusive: target.claimExclusive,
    summaryRequired: target.platform === "sohu",
    coverRequired: getRule(target.platform).cover.required,
    // 头条三图槽也会被图库填满；用户只要 1 张封面。
    coverMaxCount: target.platform === "toutiao" ? 1 : getRule(target.platform).cover.maxCount,
    coverMustBeInBody: getRule(target.platform).cover.mustBeInBody,
    platform: target.platform,
    coverImages: target.coverImages,
    bodyImages: target.bodyImages ?? [],
    coverOpenSelectors: coverUi.openSelectors,
    coverTabTexts: coverUi.tabTexts,
    coverConfirmSelectors: coverUi.confirmSelectors,
    ...sel,
    coverInputSelectors: [...coverUi.extraInputSelectors, ...sel.coverInputSelectors],
    publishSelectors: actionUi.publishSelectors,
    fallbackTags: actionUi.fallbackTags,
    actionPublishTexts: actionUi.publishTexts,
    matchMode: actionUi.matchMode,
    confirmTexts: actionUi.confirmTexts,
    confirmSelectors: actionUi.confirmSelectors,
    successTexts: actionUi.successTexts,
    preClickWaitMs: actionUi.preClickWaitMs,
    confirmWaitMs: actionUi.confirmWaitMs,
    enabledTimeoutMs: actionUi.enabledTimeoutMs,
  };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: injectFill,
      args: [arg],
    });
    const result = mergeResults(injected.map((row) => row.result));
    const catalog = await collectOptions(target.platform, { tabId: tab.id }).catch(() => undefined);
    return { platform: target.platform, ok: result.ok, message: result.message, catalog };
  } catch (err) {
    return {
      platform: target.platform,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
