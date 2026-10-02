import { BRIDGE_PATH, DEFAULT_API_PORT, type BridgeRequest, type BridgeResponse } from "@geopost/shared";

/**
 * MV3 的 service worker 会休眠，WebSocket 跟着断。
 * 把桥放在 offscreen 页里，由它重连；真正的 tabs/cookies 仍交给 background。
 */
const BRIDGE_URL = `ws://127.0.0.1:${DEFAULT_API_PORT}${BRIDGE_PATH}`;

let ws: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let connecting = false;

function setStatus(connected: boolean): void {
  void chrome.runtime.sendMessage({ type: "bridge-status", connected }).catch(() => undefined);
}

async function callBackground(req: BridgeRequest): Promise<BridgeResponse> {
  for (let i = 0; i < 4; i += 1) {
    try {
      const res = (await chrome.runtime.sendMessage({ type: "bridge-request", req })) as BridgeResponse | undefined;
      if (res) return res;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return { id: req.id, type: "error", message: "后台未响应，请到 chrome://extensions 重新加载 GeoPost 网关" };
}

function connect(): void {
  if (connecting) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  connecting = true;
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch {
    connecting = false;
    retry = setTimeout(connect, 2500);
    return;
  }

  ws.onopen = () => {
    connecting = false;
    setStatus(true);
  };

  ws.onmessage = (ev) => {
    void (async () => {
      let req: BridgeRequest;
      try {
        req = JSON.parse(String(ev.data)) as BridgeRequest;
      } catch {
        return;
      }
      let res: BridgeResponse;
      try {
        res = await callBackground(req);
      } catch (err) {
        res = {
          id: req.id,
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
      if (res && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(res));
    })();
  };

  ws.onclose = () => {
    connecting = false;
    setStatus(false);
    retry = setTimeout(connect, 2500);
  };

  ws.onerror = () => {
    connecting = false;
    ws?.close();
  };
}

void retry;
connect();
setInterval(() => {
  if (!ws || ws.readyState === WebSocket.CLOSED) connect();
}, 8000);
