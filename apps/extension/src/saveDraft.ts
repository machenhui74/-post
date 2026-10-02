import type { PublishTarget, TaskResult } from "@geopost/shared";
import { isSaveDraftEditorPlatform } from "@geopost/shared";
import { editorOf } from "./probe";

interface PackedImage {
  filename: string;
  mimeType: string;
  base64: string;
}

/** 注入 MAIN world 的存稿参数。Cookie 留在页面里，不经过 Node。 */
interface SaveDraftArg {
  platform: "weixin" | "bilibili" | "baijiahao";
  title: string;
  html: string;
  summary: string;
  tags: string[];
  claimOriginal: boolean;
  coverImages: PackedImage[];
}

function waitTab(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.get(tabId, (tab) => {
      if (tab.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
    chrome.tabs.onUpdated.addListener(listener);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function packArg(target: PublishTarget): SaveDraftArg {
  if (target.platform !== "weixin" && target.platform !== "bilibili" && target.platform !== "baijiahao") {
    throw new Error("非存稿站");
  }
  return {
    platform: target.platform,
    title: target.title,
    html: target.html,
    summary: target.summary,
    tags: target.tags,
    claimOriginal: target.claimOriginal,
    coverImages: target.coverImages,
  };
}

/**
 * 微信：cgi-bin/operate_appmsg 建草稿，再跳编辑页。不点群发。
 * 对齐 MultiPost ArticleWeixin，封面/正文图都先上传到素材。
 */
async function injectWeixin(arg: SaveDraftArg): Promise<{ ok: boolean; message: string }> {
  // 注入函数不能闭包模块变量，解码必须写在函数体内。
  const blobFromPacked = (img: PackedImage): Blob => {
    const raw = atob(img.base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: img.mimeType || "image/jpeg" });
  };

  const parseInfo = async (): Promise<{ token: string; nickname: string; ticket: string; userName: string }> => {
    const html = await (await fetch("https://mp.weixin.qq.com/")).text();
    const dataMatch = html.match(/window\.wx\.commonData\s*=\s*\{([\s\S]*?)\};/);
    const block = dataMatch?.[1] ?? html;
    const token =
      block.match(/t:\s*["'](\d+)["']/)?.[1] ||
      html.match(/token=(\d+)/)?.[1] ||
      new URLSearchParams(location.search).get("token") ||
      "";
    if (!token) throw new Error("读不到公众号 token，请先登录 mp.weixin.qq.com");
    return {
      token,
      nickname: decodeURIComponent(block.match(/nick_name:\s*["']([^"']+)["']/)?.[1] ?? ""),
      ticket: block.match(/ticket:\s*["']([^"']+)["']/)?.[1] ?? "",
      userName: block.match(/user_name:\s*["']([^"']+)["']/)?.[1] ?? "",
    };
  };

  const { token, nickname, ticket, userName } = await parseInfo();

  const uploadBlob = async (blob: Blob, scene = 8): Promise<{ fileId: number; url: string } | null> => {
    const form = new FormData();
    const name = `${Date.now()}.jpg`;
    form.append("type", blob.type || "image/jpeg");
    form.append("id", Date.now().toString());
    form.append("name", name);
    form.append("lastModifiedDate", new Date().toString());
    form.append("size", String(blob.size));
    form.append("file", blob, name);
    const url = new URL("https://mp.weixin.qq.com/cgi-bin/filetransfer");
    url.searchParams.set("action", "upload_material");
    url.searchParams.set("f", "json");
    url.searchParams.set("scene", String(scene));
    url.searchParams.set("writetype", "doublewrite");
    url.searchParams.set("groupid", "1");
    url.searchParams.set("ticket_id", userName);
    url.searchParams.set("ticket", ticket);
    url.searchParams.set("svr_time", String(Math.floor(Date.now() / 1000)));
    url.searchParams.set("token", token);
    url.searchParams.set("lang", "zh_CN");
    url.searchParams.set("seq", Date.now().toString());
    const result = (await (await fetch(url.toString(), { method: "POST", body: form })).json()) as {
      base_resp?: { err_msg?: string };
      content?: string;
      cdn_url?: string;
    };
    if (result.base_resp?.err_msg !== "ok" || !result.cdn_url) return null;
    return { fileId: Number.parseInt(result.content ?? "0", 10), url: result.cdn_url };
  };

  const rewriteHtml = async (html: string): Promise<string> => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("a").forEach((a) => {
      const span = doc.createElement("span");
      span.innerHTML = a.innerHTML;
      a.replaceWith(span);
    });
    const images = Array.from(doc.querySelectorAll("img"));
    for (const img of images) {
      const src = img.getAttribute("src");
      if (!src) continue;
      let blob: Blob | null = null;
      if (src.startsWith("data:")) {
        const res = await fetch(src);
        blob = await res.blob();
      } else if (/^https?:/i.test(src)) {
        try {
          blob = await (await fetch(src)).blob();
        } catch {
          blob = null;
        }
      }
      if (!blob) continue;
      const up = await uploadBlob(blob, 8);
      if (up) img.setAttribute("src", up.url);
    }
    return doc.body.innerHTML;
  };

  const content = await rewriteHtml(arg.html);
  const cover = arg.coverImages[0];
  if (!cover) return { ok: false, message: "公众号封面必填，未保存稿件" };
  const coverUp = await uploadBlob(blobFromPacked(cover), 8);
  if (!coverUp) return { ok: false, message: "公众号封面上传失败" };

  const form = new FormData();
  form.append("token", token);
  form.append("lang", "zh_CN");
  form.append("f", "json");
  form.append("ajax", "1");
  form.append("random", Math.random().toString());
  form.append("AppMsgId", "");
  form.append("count", "1");
  form.append("data_seq", "0");
  form.append("operate_from", "Chrome");
  form.append("isnew", "0");
  form.append("title0", arg.title);
  form.append("author0", nickname);
  form.append("writerid0", "0");
  form.append("fileid0", "");
  form.append("digest0", arg.summary.slice(0, 120));
  form.append("auto_gen_digest0", arg.summary.trim() ? "0" : "1");
  form.append("content0", content);
  form.append("sourceurl0", "");
  form.append("need_open_comment0", "1");
  form.append("only_fans_can_comment0", "0");
  form.append("cdn_url0", coverUp.url);
  form.append("cdn_235_1_url0", coverUp.url);
  form.append("cdn_16_9_url0", coverUp.url);
  form.append("cdn_1_1_url0", coverUp.url);
  form.append("cdn_url_back0", coverUp.url);
  form.append("show_cover_pic0", "0");
  form.append("copyright_type0", "0");
  form.append("fee0", "0");
  form.append("share_page_type0", "0");
  form.append("share_imageinfo0", JSON.stringify({ list: [] }));
  form.append("categories_list0", "[]");
  form.append("compose_info0", '{"list":""}');

  const postUrl = new URL("https://mp.weixin.qq.com/cgi-bin/operate_appmsg");
  postUrl.searchParams.set("t", "ajax-response");
  postUrl.searchParams.set("sub", "create");
  postUrl.searchParams.set("type", "77");
  postUrl.searchParams.set("token", token);
  postUrl.searchParams.set("lang", "zh_CN");
  const result = (await (await fetch(postUrl.toString(), { method: "POST", body: form })).json()) as {
    appMsgId?: string;
    base_resp?: { err_msg?: string };
  };
  if (!result.appMsgId) {
    return { ok: false, message: `公众号存稿失败：${result.base_resp?.err_msg ?? "无 appMsgId"}` };
  }
  const edit = new URL("https://mp.weixin.qq.com/cgi-bin/appmsg");
  edit.searchParams.set("t", "media/appmsg_edit");
  edit.searchParams.set("action", "edit");
  edit.searchParams.set("type", "77");
  edit.searchParams.set("appmsgid", String(result.appMsgId));
  edit.searchParams.set("token", token);
  edit.searchParams.set("lang", "zh_CN");
  location.href = edit.toString();
  return { ok: true, message: "已存公众号草稿并打开编辑页（未群发）" };
}

/**
 * B 站专栏：x/article/creative/draft/addupdate 存草稿，再跳编辑页。不点投稿。
 */
async function injectBilibili(arg: SaveDraftArg): Promise<{ ok: boolean; message: string }> {
  const blobFromPacked = (img: PackedImage): Blob => {
    const raw = atob(img.base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: img.mimeType || "image/jpeg" });
  };
  const cookie = (name: string) =>
    document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? "";
  const csrf = cookie("bili_jct");
  if (!csrf) return { ok: false, message: "没有 bili_jct，请先登录 member.bilibili.com" };

  const uploadImage = async (blob: Blob): Promise<string> => {
    const form = new FormData();
    form.append("file_up", blob);
    form.append("biz", "new_dyn");
    form.append("category", "daily");
    form.append("csrf", csrf);
    const result = (await (
      await fetch("https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs", {
        method: "POST",
        body: form,
        credentials: "include",
      })
    ).json()) as { code?: number; data?: { image_url?: string }; message?: string };
    if (result.code !== 0 || !result.data?.image_url) throw new Error(result.message ?? "B 站传图失败");
    return result.data.image_url;
  };

  const doc = new DOMParser().parseFromString(arg.html, "text/html");
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (!src) continue;
    try {
      const blob = await (await fetch(src)).blob();
      img.setAttribute("src", await uploadImage(blob));
    } catch {
      /* 单张失败不挡整篇 */
    }
  }
  const content = doc.body.innerHTML;
  let banner = "";
  if (arg.coverImages[0]) {
    try {
      banner = await uploadImage(blobFromPacked(arg.coverImages[0]));
    } catch {
      banner = "";
    }
  }

  const form = new FormData();
  form.append("title", arg.title.slice(0, 40));
  form.append("content", content);
  form.append("summary", arg.summary);
  form.append("banner_url", banner);
  form.append("words", String((doc.body.textContent ?? "").length));
  form.append("category", "0");
  form.append("list_id", "0");
  form.append("tid", "0");
  form.append("reprint", arg.claimOriginal ? "0" : "1");
  form.append("tags", arg.tags.join(","));
  form.append("image_urls", "");
  form.append("origin_image_urls", "");
  form.append("dynamic_intro", arg.summary);
  form.append("media_id", "0");
  form.append("spoiler", "0");
  form.append("original", arg.claimOriginal ? "1" : "0");
  form.append("top_video_bvid", "");
  form.append("csrf", csrf);

  const result = (await (
    await fetch("https://api.bilibili.com/x/article/creative/draft/addupdate", {
      method: "POST",
      body: form,
      credentials: "include",
    })
  ).json()) as { code?: number; data?: { aid?: number }; message?: string };
  if (result.code !== 0 || !result.data?.aid) {
    return { ok: false, message: `B 站专栏存稿失败：${result.message ?? "无 aid"}` };
  }
  location.href = `https://member.bilibili.com/article-text/home?aid=${result.data.aid}`;
  return { ok: true, message: "已存 B 站专栏草稿并打开编辑页（未投稿）" };
}

/**
 * 百家号：pcui/article/save 存草稿，再跳 rc/edit。不点发布。
 */
async function injectBaijiahao(arg: SaveDraftArg): Promise<{ ok: boolean; message: string }> {
  const blobFromPacked = (img: PackedImage): Blob => {
    const raw = atob(img.base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: img.mimeType || "image/jpeg" });
  };
  const token = (localStorage.getItem("edit-token") ?? "").replace(/"/g, "");
  const uploadImage = async (blob: Blob, filename: string): Promise<string | null> => {
    const form = new FormData();
    form.append("org_file_name", filename);
    form.append("type", "image");
    form.append("app_id", "");
    form.append("is_waterlog", "1");
    form.append("save_material", "1");
    form.append("no_compress", "0");
    form.append("is_events", "");
    form.append("article_type", "news");
    form.append("media", blob, filename);
    const result = (await (
      await fetch("https://baijiahao.baidu.com/materialui/picture/uploadProxy", {
        method: "POST",
        body: form,
        credentials: "include",
        headers: token ? { Token: token } : undefined,
      })
    ).json()) as { ret?: { https_url?: string } };
    return result.ret?.https_url ?? null;
  };

  const doc = new DOMParser().parseFromString(arg.html, "text/html");
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (!src) continue;
    try {
      const blob = await (await fetch(src)).blob();
      const url = await uploadImage(blob, "body.jpg");
      if (url) img.setAttribute("src", url);
    } catch {
      /* 单张失败不挡整篇 */
    }
  }
  const content = doc.body.innerHTML;
  let coverUrl = "";
  if (arg.coverImages[0]) {
    coverUrl = (await uploadImage(blobFromPacked(arg.coverImages[0]), arg.coverImages[0].filename)) ?? "";
  }

  const form = new FormData();
  form.append("type", "news");
  form.append("title", arg.title.slice(0, 64));
  form.append("content", content);
  form.append("vertical_cover", coverUrl);
  form.append("abstract", arg.summary);
  form.append("len", String((doc.body.textContent ?? "").length));
  form.append("activity_list[0][id]", "ttv");
  form.append("activity_list[0][is_checked]", "1");
  form.append("activity_list[1][id]", "ai_tts");
  form.append("activity_list[1][is_checked]", "1");
  form.append("activity_list[2][id]", "reward");
  form.append("activity_list[2][is_checked]", "1");
  form.append("activity_list[3][id]", "aigc_bjh_status");
  form.append("activity_list[3][is_checked]", "0");
  form.append("source_reprinted_allow", "0");
  form.append("is_auto_optimize_cover", "1");
  form.append("abstract_from", "1");
  form.append("cover_layout", "one");
  form.append("source", "upload");
  form.append("cover_source", "upload");
  if (coverUrl) {
    form.append(
      "cover_images",
      JSON.stringify([{ src: coverUrl, cropData: { x: 0, y: 0, width: 0, height: 0 }, machine_chooseimg: 0, isLegal: 0 }]),
    );
  }

  const result = (await (
    await fetch("https://baijiahao.baidu.com/pcui/article/save?callback=bjhdraft", {
      method: "POST",
      body: form,
      credentials: "include",
      headers: token ? { Token: token } : undefined,
    })
  ).json()) as { errno?: number; ret?: { id?: string }; message?: string };
  if (result.errno !== 0 || !result.ret?.id) {
    return { ok: false, message: `百家号存稿失败：${result.message ?? "无 article_id"}` };
  }
  location.href = `https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=${result.ret.id}`;
  return { ok: true, message: "已存百家号草稿并打开编辑页（未发布）" };
}

/**
 * 开官方页 → MAIN world 调保存稿件接口 → 跳编辑页。
 * 不上线、不群发。
 */
export async function saveDraftThenOpenEditor(target: PublishTarget): Promise<TaskResult> {
  if (!isSaveDraftEditorPlatform(target.platform)) {
    return { platform: target.platform, ok: false, message: "不是存稿跳转站" };
  }
  const url = editorOf(target.platform);
  const tab = await chrome.tabs.create({ url, active: true });
  if (!tab.id) return { platform: target.platform, ok: false, message: "无法打开标签页" };
  await waitTab(tab.id);
  await sleep(2200);
  const func =
    target.platform === "weixin" ? injectWeixin : target.platform === "bilibili" ? injectBilibili : injectBaijiahao;
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func,
      args: [packArg(target)],
    });
    const row = injected[0]?.result;
    return {
      platform: target.platform,
      ok: Boolean(row?.ok),
      message: row?.message ?? "存稿脚本无返回",
      editorOpened: true,
    };
  } catch (err) {
    return {
      platform: target.platform,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      editorOpened: true,
    };
  }
}
