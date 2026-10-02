import type { BridgeRequest, BridgeResponse } from "@geopost/shared";
import { editorOf, probeAll, probeOneDetailed } from "../src/probe";
import { fillOfficialPage } from "../src/fill";

async function ensureOffscreen(): Promise<void> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      // 官方没有 WEBSOCKET reason；用 BLOBS 挂住不关闭的文档来保活本地桥。
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "保持与本机 GeoPost 服务的 WebSocket，避免 service worker 休眠后网关断开",
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("single offscreen") || msg.includes("already exists")) return;
    console.warn("geopost offscreen", err);
  }
}

async function handle(req: BridgeRequest): Promise<BridgeResponse> {
  if (req.type === "ping") {
    return { id: req.id, type: "pong", extensionReady: true };
  }
  if (req.type === "listAccounts") {
    const { accounts, catalogs } = await probeAll(Boolean(req.spawn));
    return { id: req.id, type: "accounts", accounts, catalogs };
  }
  if (req.type === "probePlatform") {
    const result = await probeOneDetailed(req.platform, req.spawn !== false, true);
    return { id: req.id, type: "account", result };
  }
  if (req.type === "openEditor") {
    const url = req.url || editorOf(req.platform);
    if (!url) throw new Error("未配置打开地址（企业官网请先填写 URL）");
    await chrome.tabs.create({ url, active: true });
    return { id: req.id, type: "opened", platform: req.platform };
  }
  if (req.type === "saveDraft" || req.type === "publish") {
    const result = await fillOfficialPage(editorOf(req.payload.platform), req.payload);
    return { id: req.id, type: "task", result };
  }
  return { id: req.id, type: "error", message: "未知指令" };
}

/**
 * 后台只跑 Chrome API。WebSocket 在 offscreen，休眠后仍能被消息叫醒。
 */
export default defineBackground(() => {
  void ensureOffscreen();
  chrome.runtime.onStartup.addListener(() => void ensureOffscreen());
  chrome.runtime.onInstalled.addListener(() => void ensureOffscreen());
  chrome.alarms.create("geopost-bridge", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "geopost-bridge") void ensureOffscreen();
  });

  chrome.runtime.onMessage.addListener((msg: { type?: string; connected?: boolean; req?: BridgeRequest }, _sender, sendResponse) => {
    if (msg?.type === "bridge-status") {
      void chrome.action.setBadgeText({ text: msg.connected ? "ON" : "" });
      if (msg.connected) {
        void chrome.action.setBadgeBackgroundColor({ color: "#7cb87c" });
      }
      void chrome.storage.local.set({ bridgeConnected: Boolean(msg.connected) });
      return;
    }
    if (msg?.type === "bridge-request" && msg.req) {
      void handle(msg.req)
        .then(sendResponse)
        .catch((err: unknown) => {
          sendResponse({
            id: msg.req!.id,
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          } satisfies BridgeResponse);
        });
      return true;
    }
    return undefined;
  });
});
