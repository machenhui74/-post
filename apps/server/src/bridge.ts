import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { createId, type AccountInfo, type EditorOptionCatalog, type BridgeRequest, type BridgeResponse, type PlatformId, type PlatformProbeResult, type PublishTarget, type TaskResult } from "@geopost/shared";
import { logger } from "./logger.js";

interface Pending {
  resolve: (value: BridgeResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const sockets = new Set<WebSocket>();
const pending = new Map<string, Pending>();

type AliveSocket = WebSocket & { isAlive?: boolean };

export function extensionConnected(): boolean {
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) return true;
  }
  return false;
}

export function attachBridge(wss: WebSocketServer): void {
  setInterval(() => {
    for (const raw of sockets) {
      const ws = raw as AliveSocket;
      if (ws.readyState !== ws.OPEN) {
        sockets.delete(raw);
        continue;
      }
      if (ws.isAlive === false) {
        logger.warn("bridge.stale_socket");
        ws.terminate();
        sockets.delete(raw);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);

  wss.on("connection", (ws: AliveSocket, req: IncomingMessage) => {
    const host = req.headers.host ?? "";
    if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
      logger.warn("bridge.reject_remote", { host });
      ws.close();
      return;
    }
    ws.isAlive = true;
    sockets.add(ws);
    logger.info("bridge.connected", { clients: sockets.size });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as BridgeResponse;
        const wait = pending.get(msg.id);
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(msg.id);
          wait.resolve(msg);
        }
      } catch (err) {
        logger.error("bridge.bad_message", { err: String(err) });
      }
    });

    ws.on("error", () => {
      sockets.delete(ws);
    });

    ws.on("close", () => {
      sockets.delete(ws);
      logger.info("bridge.disconnected", { clients: sockets.size });
    });
  });
}

function send(req: BridgeRequest, timeoutMs = 45000): Promise<BridgeResponse> {
  const open = [...sockets].filter((ws) => ws.readyState === ws.OPEN);
  if (!open.length) {
    return Promise.reject(new Error("扩展未连接。请在 chrome://extensions 加载并重新加载 GeoPost 网关。"));
  }
  logger.info("bridge.send", { type: req.type, id: req.id });
  const payload = JSON.stringify(req);
  for (const ws of open) {
    try {
      ws.send(payload);
    } catch (err) {
      sockets.delete(ws);
      logger.warn("bridge.send_fail", { err: String(err) });
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(req.id);
      reject(new Error(`扩展响应超时: ${req.type}`));
    }, timeoutMs);
    pending.set(req.id, { resolve, reject, timer });
  });
}

export async function pingExtension(): Promise<boolean> {
  try {
    const res = await send({ id: createId("ping"), type: "ping" }, 4000);
    return res.type === "pong";
  } catch (err) {
    logger.warn("bridge.ping_fail", { err: String(err) });
    return false;
  }
}

export async function listAccounts(spawn = false): Promise<{ accounts: AccountInfo[]; catalogs: EditorOptionCatalog[] }> {
  const res = await send({ id: createId("acc"), type: "listAccounts", spawn }, 45000);
  if (res.type !== "accounts") throw new Error(res.type === "error" ? res.message : "账号探测失败");
  logger.info("bridge.accounts", {
    spawn,
    loggedIn: res.accounts.filter((a) => a.loggedIn).map((a) => a.platform),
    catalogs: (res.catalogs ?? []).map((c) => c.platform),
  });
  return { accounts: res.accounts, catalogs: res.catalogs ?? [] };
}

/** 右侧单站刷新：spawn 开后台再探，并拉发文可选项。 */
export async function probePlatformAccount(platform: PlatformId, spawn = true): Promise<PlatformProbeResult> {
  logger.info("bridge.probe_platform", { platform, spawn });
  const res = await send({ id: createId("acc1"), type: "probePlatform", platform, spawn }, 45000);
  if (res.type === "error") throw new Error(res.message);
  if (res.type !== "account") throw new Error("单站探测失败");
  logger.info("bridge.probe_platform.done", {
    platform,
    loggedIn: res.result.account.loggedIn,
    catalog: res.result.catalog?.source,
    categories: res.result.catalog?.categories.length,
  });
  return res.result;
}

export async function openEditor(platform: PlatformId, url?: string): Promise<void> {
  logger.info("bridge.open_editor", { platform, url });
  const res = await send({ id: createId("open"), type: "openEditor", platform, url });
  if (res.type === "error") throw new Error(res.message);
}

export async function runPublish(mode: "saveDraft" | "publish", payload: PublishTarget): Promise<TaskResult> {
  logger.info("bridge.publish", { mode, platform: payload.platform });
  const res = await send({ id: createId("pub"), type: mode, payload }, 120000);
  if (res.type === "task") return res.result;
  if (res.type === "error") {
    return { platform: payload.platform, ok: false, message: res.message };
  }
  return { platform: payload.platform, ok: false, message: "扩展返回异常" };
}
