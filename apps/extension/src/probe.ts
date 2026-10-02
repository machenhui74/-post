import { PLATFORM_IDS, canOpenEditorToScan, type AccountInfo, type EditorOptionCatalog, type PlatformId, type PlatformProbeResult } from "@geopost/shared";
import { getEditorUrl } from "@geopost/rules";
import { collectOptions, collectOptionsFromOpenTabs } from "./options";

/**
 * 已登录 = 创作者后台资料里读到真实昵称。
 * Cookie 只用来决定要不要打开后台页再探，不能单独把卡片打成已登录。
 */
interface ProbeSpec {
  homeUrl: string;
  tabMatch: string | string[];
  urls: string[];
  namePaths: string[];
  avatarPaths: string[];
  /** 接口若是消费者站通用登录（如 B 站 nav），禁止在扩展后台直接请求，避免看视频号被当成专栏已登录。 */
  allowServiceWorkerFetch?: boolean;
}

const NAME_KEYS = [
  "nickName",
  "nickname",
  "nick_name",
  "userNick",
  "userName",
  "username",
  "media_name",
  "mediaName",
  "uname",
  "screen_name",
  "accountName",
  "account_name",
  "appName",
  "displayName",
  "fullname",
];

const SPECS: Record<PlatformId, ProbeSpec> = {
  sohu: {
    homeUrl: "https://mp.sohu.com/",
    tabMatch: "https://mp.sohu.com/*",
    urls: [
      "https://mp.sohu.com/api/user/info",
      "https://mp.sohu.com/mpfe/v3/login/check",
      "https://mp.sohu.com/mpfe/v4/user/info",
      "https://mp.sohu.com/commons/front/inter/account/getAccountInfo",
    ],
    namePaths: [
      "data.nickName",
      "data.nickname",
      "data.name",
      "data.username",
      "data.userName",
      "data.accountName",
      "data.user.nickName",
      "data.user.nickname",
      "data.userInfo.nickName",
      "data.userInfo.nickname",
      "data.userInfo.name",
      "result.nickName",
      "result.nickname",
    ],
    avatarPaths: ["data.avatar", "data.headImg", "data.profilePicture", "data.headPic", "data.user.avatar"],
  },
  netease: {
    homeUrl: "https://mp.163.com/",
    tabMatch: "https://mp.163.com/*",
    urls: ["https://mp.163.com/wemedia/front/user/info"],
    namePaths: ["data.nickname", "data.name", "data.user.nickname"],
    avatarPaths: ["data.avatar", "data.head", "data.user.avatar"],
  },
  toutiao: {
    homeUrl: "https://mp.toutiao.com/",
    tabMatch: "https://mp.toutiao.com/*",
    urls: [
      "https://mp.toutiao.com/mp/agw/creator_v2/user/info",
      "https://mp.toutiao.com/mp/agw/media/user_login_status_api",
    ],
    namePaths: ["data.name", "data.user.name", "data.screen_name", "data.user.screen_name"],
    avatarPaths: ["data.avatar", "data.user.avatar", "data.avatar_url"],
  },
  zhihu: {
    homeUrl: "https://www.zhihu.com/",
    tabMatch: ["https://www.zhihu.com/*", "https://zhuanlan.zhihu.com/*"],
    urls: ["https://www.zhihu.com/api/v4/me"],
    namePaths: ["name", "fullname"],
    avatarPaths: ["avatar_url", "avatarUrl"],
  },
  qiehao: {
    homeUrl: "https://om.qq.com/",
    tabMatch: "https://om.qq.com/*",
    urls: ["https://om.qq.com/basis/user/info"],
    namePaths: ["data.media_name", "data.name", "data.user.name"],
    avatarPaths: ["data.head_url", "data.avatar"],
  },
  baijiahao: {
    homeUrl: "https://baijiahao.baidu.com/",
    tabMatch: "https://baijiahao.baidu.com/*",
    urls: ["https://baijiahao.baidu.com/builder/author/app/appinfo"],
    namePaths: ["data.name", "data.user.name", "data.appName"],
    avatarPaths: ["data.avatar", "data.user.avatar", "data.appImage"],
  },
  weixin: {
    homeUrl: "https://mp.weixin.qq.com/",
    tabMatch: "https://mp.weixin.qq.com/*",
    urls: [],
    namePaths: [],
    avatarPaths: [],
  },
  csdn: {
    homeUrl: "https://mp.csdn.net/",
    tabMatch: "https://mp.csdn.net/*",
    urls: ["https://blog.csdn.net/phoenix/web/blog/check-user", "https://mp.csdn.net/mp_blog/getUserInfo"],
    namePaths: ["data.username", "data.nickname", "data.userName"],
    avatarPaths: ["data.avatar", "data.avatarUrl"],
  },
  juejin: {
    homeUrl: "https://juejin.cn/editor/drafts/new",
    tabMatch: ["https://juejin.cn/editor/*", "https://juejin.cn/user/*"],
    urls: ["https://api.juejin.cn/user_api/v1/user/get"],
    namePaths: ["data.user_name", "data.user.user_name"],
    avatarPaths: ["data.avatar_large", "data.avatar"],
  },
  cnblogs: {
    homeUrl: "https://i.cnblogs.com/",
    tabMatch: "https://i.cnblogs.com/*",
    urls: ["https://account.cnblogs.com/user/current"],
    namePaths: ["displayName", "name", "loginName"],
    avatarPaths: ["avatar", "icon"],
  },
  bilibili: {
    homeUrl: "https://member.bilibili.com/platform/home",
    tabMatch: "https://member.bilibili.com/*",
    urls: ["https://api.bilibili.com/x/web-interface/nav"],
    namePaths: ["data.uname"],
    avatarPaths: ["data.face"],
    allowServiceWorkerFetch: false,
  },
  baike: {
    homeUrl: "https://baike.baidu.com/",
    tabMatch: "https://baike.baidu.com/*",
    urls: [],
    namePaths: [],
    avatarPaths: [],
  },
  website: {
    homeUrl: "",
    tabMatch: "",
    urls: [],
    namePaths: [],
    avatarPaths: [],
  },
};

const PLACEHOLDER_EXACT = /^(已登录|公众号|未登录|请登录|登录|游客|匿名|用户|用户名|个人中心|nickname|username|搜狐号|头条号)$/i;
const PLACEHOLDER_CONTAINS = /请登录|点击登录|立即登录|登录\/注册|登录注册/;
const PLACEHOLDER_AVATAR = /noface|default[_-]?avatar|default_head|anonymous|placeholder|no[_-]?login|guest|empty.?avatar/i;

/** 只看路径，避免 ?from=login 把已登录后台误判成登录页。 */
function isLoginUrl(href: string): boolean {
  try {
    const path = new URL(href).pathname.toLowerCase();
    return /login|passport|signin|userauth|bizlogin|qrcode/.test(path) || /\/auth\//.test(path);
  } catch {
    return false;
  }
}

function pickString(obj: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      if (!cur || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === "string" && cur.trim()) return cur.trim();
  }
  return undefined;
}

function isPlaceholderName(name: string | undefined): boolean {
  if (!name) return true;
  const t = name.trim();
  if (t.length < 2 || t.length > 40) return true;
  return PLACEHOLDER_EXACT.test(t) || PLACEHOLDER_CONTAINS.test(t);
}

function isRealAvatar(url: string | undefined): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !PLACEHOLDER_AVATAR.test(url);
}

function nested(obj: Record<string, unknown>, key: string): unknown {
  const data = obj.data;
  if (data && typeof data === "object") return (data as Record<string, unknown>)[key];
  return obj[key];
}

/** 资料接口明确未登录；success:false 与 MultiPost 搜狐判断一致。 */
function identityDenied(json: Record<string, unknown>): boolean {
  const flags = [json.isLogin, json.is_login, nested(json, "isLogin"), nested(json, "is_login")];
  if (flags.some((v) => v === false || v === 0 || v === "0")) return true;
  if (json.success === false) return true;
  return false;
}

/** 接口明确说已登录，即使昵称字段名对不上也不能判未登录。 */
function identityGranted(json: Record<string, unknown>): boolean {
  const flags = [json.isLogin, json.is_login, nested(json, "isLogin"), nested(json, "is_login")];
  return flags.some((v) => v === true || v === 1 || v === "1");
}

function hasUserKey(json: Record<string, unknown>): boolean {
  const data = json.data;
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : json;
  for (const key of ["userId", "uid", "user_id", "accountId", "mediaId", "account_id", "appId"]) {
    const val = obj[key] ?? json[key];
    if (typeof val === "number" && val > 0) return true;
    if (typeof val === "string" && val.length > 1 && val !== "0" && val !== "unknown") return true;
  }
  return false;
}

/** 各站字段名不统一，在 data/result/user 里找昵称键，不扫整包随便一个 name。 */
function findKnownName(obj: unknown, depth = 0): string | undefined {
  if (!obj || typeof obj !== "object" || depth > 4) return undefined;
  const rec = obj as Record<string, unknown>;
  for (const key of NAME_KEYS) {
    const val = rec[key];
    if (typeof val === "string" && !isPlaceholderName(val)) return val.trim();
  }
  for (const child of [rec.data, rec.result, rec.user, rec.account, rec.userInfo, rec.media, rec.creator]) {
    const found = findKnownName(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function profileFromJson(json: Record<string, unknown> | null, spec: ProbeSpec): { name: string; avatar?: string } | null {
  if (!json || identityDenied(json)) return null;
  const name = pickString(json, spec.namePaths) ?? findKnownName(json);
  const avatar = pickString(json, spec.avatarPaths);
  const avatarOk = isRealAvatar(avatar) ? avatar : undefined;
  if (name && !isPlaceholderName(name)) return { name, avatar: avatarOk };
  // 搜狐等站 success+data.userId 但昵称键不在名单里时，仍算已登录。
  if (identityGranted(json) || hasUserKey(json)) return { name: "已登录", avatar: avatarOk };
  return null;
}

function parseMaybeJson(text: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(text) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fetchJsonSw(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return parseMaybeJson(await res.text());
  } catch {
    return null;
  }
}

function waitTab(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), 8000);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(t);
        setTimeout(resolve, 1500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function fetchJsonInTab(tabId: number, apiUrl: string): Promise<Record<string, unknown> | null> {
  try {
      const injected = await chrome.scripting.executeScript({
      target: { tabId },
      // 隔离世界请求，避免页面改写 fetch；Cookie 仍随该后台域发送。
      func: async (url: string) => {
        const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
        return { status: res.status, href: location.href, text: await res.text() };
      },
      args: [apiUrl],
    });
    const row = injected[0]?.result;
    if (!row?.text) return null;
    if (isLoginUrl(row.href)) return null;
    return parseMaybeJson(row.text);
  } catch {
    return null;
  }
}

/** SPA 常把用户挂在全局对象或本地存储里，接口字段对不上时再读一次。 */
async function readPageState(tabId: number): Promise<Record<string, unknown>[]> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const w = window as unknown as Record<string, unknown>;
        const out: Record<string, unknown>[] = [];
        for (const key of ["__INITIAL_STATE__", "__USER__", "userInfo", "_user", "__MP_USER__", "g_user", "mpUser"]) {
          const val = w[key];
          if (val && typeof val === "object") out.push(val as Record<string, unknown>);
        }
        for (const store of [localStorage, sessionStorage]) {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (!key || !/user|account|login|profile|nick|member|media/i.test(key)) continue;
            try {
              const parsed = JSON.parse(store.getItem(key) ?? "") as unknown;
              if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
            } catch {
              /* 非 JSON 忽略 */
            }
          }
        }
        return out;
      },
    });
    const val = injected[0]?.result;
    return Array.isArray(val) ? val : [];
  } catch {
    return [];
  }
}

/**
 * 只在创作者后台 tab 里读头部昵称。选择器故意不写 [class*=name]，避免扫到「用户名」标签。
 */
async function readDomIdentity(tabId: number): Promise<{ name: string; avatar?: string } | null> {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (/login|passport|signin|userauth|bizlogin|qrcode/i.test(location.pathname)) return null;
        const nameEl = document.querySelector(
          ".user-name, .nickname, .username, .account-name, [class*='nickName'], [class*='userName'], [class*='accountName'], [class*='media-name']",
        );
        const avatarEl = document.querySelector(
          ".avatar img, .user-avatar img, [class*='avatar'] img",
        ) as HTMLImageElement | null;
        return { name: nameEl?.textContent?.trim() ?? "", avatar: avatarEl?.src };
      },
    });
    const row = injected[0]?.result;
    if (!row?.name || isPlaceholderName(row.name)) return null;
    return { name: row.name, avatar: isRealAvatar(row.avatar) ? row.avatar : undefined };
  } catch {
    return null;
  }
}

async function existingTab(match: string | string[]): Promise<number | undefined> {
  const patterns = Array.isArray(match) ? match : [match];
  for (const pattern of patterns) {
    if (!pattern) continue;
    const tabs = await chrome.tabs.query({ url: pattern });
    const id = tabs.find((t) => t.id && t.status === "complete" && t.url && !isLoginUrl(t.url))?.id;
    if (id) return id;
  }
  return undefined;
}

function editorUrlPattern(editorUrl: string): string {
  try {
    const u = new URL(editorUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${u.origin}/${parts.slice(0, -1).join("/")}/*`;
    return `${u.origin}${u.pathname}*`;
  } catch {
    return editorUrl;
  }
}

async function existingEditorTab(id: PlatformId): Promise<number | undefined> {
  const editorUrl = getEditorUrl(id);
  if (!editorUrl) return undefined;
  const tabs = await chrome.tabs.query({ url: editorUrlPattern(editorUrl) });
  return tabs.find((t) => t.id && t.status === "complete" && t.url && !isLoginUrl(t.url))?.id;
}

/** 单站刷新：已有发文 tab 就扫；没有且允许开页时后台打开编辑器扫完再关。 */
async function editorTabForScan(
  id: PlatformId,
  spawn: boolean,
  holdLock: boolean,
): Promise<{ tabId: number; spawned: boolean } | null> {
  const existing = await existingEditorTab(id);
  if (existing) return { tabId: existing, spawned: false };
  if (!spawn || !canOpenEditorToScan(id)) return null;
  const editorUrl = getEditorUrl(id);
  if (!editorUrl) return null;
  const open = async (): Promise<{ tabId: number; spawned: boolean } | null> => {
    const tab = await chrome.tabs.create({ url: editorUrl, active: false });
    if (!tab.id) return null;
    try {
      await waitTab(tab.id);
      await new Promise((r) => setTimeout(r, 2200));
      const [loc] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => location.href,
      });
      if (isLoginUrl(String(loc.result ?? ""))) {
        await chrome.tabs.remove(tab.id).catch(() => undefined);
        return null;
      }
      return { tabId: tab.id, spawned: true };
    } catch {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      return null;
    }
  };
  // 已在 withSiteTab 锁里时不能再抢同一把锁，否则会自己等自己。
  return holdLock ? withSpawnLock(open) : open();
}

async function collectOptionsWithEditor(
  id: PlatformId,
  accountName: string | undefined,
  homeTabId: number | undefined,
  spawnEditor: boolean,
  holdLock = true,
): Promise<EditorOptionCatalog> {
  const editor = await editorTabForScan(id, spawnEditor, holdLock);
  try {
    return await collectOptions(id, {
      tabIds: [homeTabId, editor?.tabId].filter((n): n is number => typeof n === "number"),
      accountName,
    });
  } finally {
    if (editor?.spawned) await chrome.tabs.remove(editor.tabId).catch(() => undefined);
  }
}

const ANALYTICS_COOKIE = /^(Hm_|_ga|_gid|_gat|utm|_clck|_clsk|__gads|AMP_TOKEN|sensorsdata)/i;

/**
 * 会不会给后台带上会话 Cookie。父域（.sohu.com）也算，只用于决定要不要打开后台再探，不直接打成已登录。
 * 上一版只认 host 完全相等，搜狐登录态在 .sohu.com 时已登录也会显示去登录。
 */
async function hasLikelySessionCookie(homeUrl: string): Promise<boolean> {
  if (!homeUrl) return false;
  const host = new URL(homeUrl).hostname;
  const cookies = await chrome.cookies.getAll({ url: homeUrl });
  return cookies.some((c) => {
    if (!c.value || c.value.length < 6 || ANALYTICS_COOKIE.test(c.name)) return false;
    // 公众号父域是 .qq.com，人人都有；只认后台自己的票才开页。
    if (host === "mp.weixin.qq.com") return /wxuin|slave_user|slave_sid|data_ticket|bizuin/i.test(c.name);
    return true;
  });
}

let spawnLock = Promise.resolve();

function withSpawnLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = spawnLock.then(fn, fn);
  spawnLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function withSiteTab<T>(spec: ProbeSpec, allowSpawn: boolean, fn: (tabId: number) => Promise<T>): Promise<T | null> {
  const opened = await existingTab(spec.tabMatch);
  if (opened) return fn(opened);
  if (!allowSpawn || !spec.homeUrl) return null;
  return withSpawnLock(async () => {
    const tab = await chrome.tabs.create({ url: spec.homeUrl, active: false });
    if (!tab.id) return null;
    try {
      await waitTab(tab.id);
      const [loc] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => location.href,
      });
      if (isLoginUrl(String(loc.result ?? ""))) return null;
      return await fn(tab.id);
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  });
}

function loggedIn(id: PlatformId, name: string, avatar?: string): AccountInfo {
  return { platform: id, loggedIn: true, name, avatar, canPublish: true };
}

function loggedOut(id: PlatformId, detail = "未登录"): AccountInfo {
  return { platform: id, loggedIn: false, canPublish: false, detail };
}

async function probeWeixin(allowSpawn: boolean, withOptions: boolean): Promise<PlatformProbeResult> {
  const read = async (tabId: number): Promise<PlatformProbeResult | null> => {
    const [row] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const html = document.documentElement.innerHTML;
        const name =
          html.match(/nick_name\s*[:=]\s*['"]([^'"]+)/)?.[1] ??
          html.match(/"nick_name"\s*:\s*"([^"]+)"/)?.[1];
        const avatar = html.match(/head_img\s*[:=]\s*['"]([^'"]+)/)?.[1] ?? html.match(/"head_img"\s*:\s*"([^"]+)"/)?.[1];
        return { href: location.href, name, avatar };
      },
    });
    const r = row?.result;
    if (!r || isLoginUrl(r.href) || !r.name || isPlaceholderName(r.name)) return null;
    const account = loggedIn("weixin", r.name, isRealAvatar(r.avatar) ? r.avatar : undefined);
    const catalog = withOptions ? await collectOptions("weixin", { tabId, accountName: account.name }) : undefined;
    return { account, catalog };
  };

  const opened = await existingTab(SPECS.weixin.tabMatch);
  if (opened) {
    const hit = await read(opened);
    if (hit) return hit;
  }
  if (allowSpawn) {
    const spawned = await withSiteTab(SPECS.weixin, true, read);
    if (spawned) return spawned;
  }
  return { account: loggedOut("weixin") };
}

async function probePlatform(id: PlatformId, allowSpawn: boolean, withOptions: boolean): Promise<PlatformProbeResult> {
  const spec = SPECS[id];

  if (spec.allowServiceWorkerFetch !== false) {
    for (const url of spec.urls) {
      const profile = profileFromJson(await fetchJsonSw(url), spec);
      if (profile) {
        const account = loggedIn(id, profile.name, profile.avatar);
        if (!withOptions) return { account };
        const homeTabId = await existingTab(spec.tabMatch);
        const catalog = await collectOptionsWithEditor(id, profile.name, homeTabId, Boolean(allowSpawn));
        if (catalog.source !== "static" || !allowSpawn) return { account, catalog };
        const spawned = await withSiteTab(spec, true, async (tabId) =>
          collectOptionsWithEditor(id, profile.name, tabId, false, false),
        );
        return { account, catalog: spawned ?? catalog };
      }
    }
  }

  const fromTab = await withSiteTab(spec, allowSpawn, async (tabId) => {
    let profile: { name: string; avatar?: string } | null = null;
    for (const url of spec.urls) {
      profile = profileFromJson(await fetchJsonInTab(tabId, url), spec);
      if (profile) break;
    }
    if (!profile) {
      for (const state of await readPageState(tabId)) {
        profile = profileFromJson(state, spec);
        if (profile) break;
      }
    }
    if (!profile) profile = await readDomIdentity(tabId);
    if (!profile) return null;
    const catalog = withOptions ? await collectOptionsWithEditor(id, profile.name, tabId, Boolean(allowSpawn), false) : undefined;
    return { profile, catalog };
  });
  if (fromTab) {
    return {
      account: loggedIn(id, fromTab.profile.name, fromTab.profile.avatar),
      catalog: fromTab.catalog,
    };
  }

  return { account: loggedOut(id) };
}

function skipAccount(id: PlatformId, detail: string): PlatformProbeResult {
  return { account: { platform: id, loggedIn: false, canPublish: false, detail } };
}

export async function probeOneDetailed(
  id: PlatformId,
  allowSpawn = false,
  withOptions = false,
): Promise<PlatformProbeResult> {
  if (id === "website") return skipAccount(id, "不探测登录，只打开你配置的 URL");
  if (id === "baike") return skipAccount(id, "请人工维护词条，不探测登录");
  if (id === "weixin") return probeWeixin(allowSpawn, withOptions);
  return probePlatform(id, allowSpawn, withOptions);
}

export async function probeOne(id: PlatformId, allowSpawn = false): Promise<AccountInfo> {
  return (await probeOneDetailed(id, allowSpawn, false)).account;
}

let hintSpawned = false;

/**
 * spawn=true：用户点「刷新登录」或插件刚连上。
 * 只给「后台 URL 会带上会话 Cookie」的站开后台再探，避免没登录的站被狂开标签。
 * 登录确认后才拉可选项；20s 轮询 spawn=false 不拉，避免刷接口。
 */
export async function probeAll(
  allowSpawn = false,
): Promise<{ accounts: AccountInfo[]; catalogs: EditorOptionCatalog[] }> {
  const first = await Promise.all(PLATFORM_IDS.map((id) => probeOneDetailed(id, false, false)));
  const retried = new Map<PlatformId, PlatformProbeResult>();
  const allowHint = allowSpawn || !hintSpawned;
  hintSpawned = true;

  const jobs = first.filter((row) => {
    if (row.account.loggedIn) return false;
    const spec = SPECS[row.account.platform];
    return Boolean(spec.homeUrl) && (spec.urls.length > 0 || row.account.platform === "weixin");
  });

  await Promise.all(
    jobs.map(async (row) => {
      const spec = SPECS[row.account.platform];
      const sessionCookie = await hasLikelySessionCookie(spec.homeUrl);
      if (!(allowHint && sessionCookie)) return;
      const next = await probeOneDetailed(row.account.platform, true, allowSpawn);
      retried.set(row.account.platform, next);
    }),
  );

  const merged = first.map((row) => retried.get(row.account.platform) ?? row);
  const accounts = merged.map((row) => row.account);
  const catalogs: EditorOptionCatalog[] = [];
  if (allowSpawn) {
    await Promise.all(
      merged.map(async (row) => {
        if (!row.account.loggedIn) return;
        if (row.catalog) {
          catalogs.push(row.catalog);
          return;
        }
        const spec = SPECS[row.account.platform];
        catalogs.push(await collectOptionsFromOpenTabs(row.account.platform, spec.tabMatch, row.account.name));
      }),
    );
  }
  return { accounts, catalogs };
}

export function editorOf(id: PlatformId): string {
  return getEditorUrl(id);
}
