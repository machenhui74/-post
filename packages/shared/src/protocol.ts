import type { AccountInfo, EditorOptionCatalog, PlatformProbeResult, PublishTarget, TaskResult } from "./models.js";
import type { PlatformId } from "./platforms.js";

/** 控制台/MCP 只发指令；Cookie 始终留在浏览器里。 */
export type BridgeRequest =
  | { id: string; type: "ping" }
  | { id: string; type: "listAccounts"; spawn?: boolean }
  /** 右侧平台按钮单独刷新：只探这一家，登录确认后顺手拉可选项。 */
  | { id: string; type: "probePlatform"; platform: PlatformId; spawn?: boolean }
  | { id: string; type: "openEditor"; platform: PlatformId; url?: string }
  | { id: string; type: "saveDraft"; payload: PublishTarget }
  | { id: string; type: "publish"; payload: PublishTarget };

export type BridgeResponse =
  | { id: string; type: "pong"; extensionReady: true }
  | { id: string; type: "accounts"; accounts: AccountInfo[]; catalogs?: EditorOptionCatalog[] }
  | { id: string; type: "account"; result: PlatformProbeResult }
  | { id: string; type: "opened"; platform: PlatformId }
  | { id: string; type: "task"; result: TaskResult }
  | { id: string; type: "error"; message: string };

export const BRIDGE_PATH = "/bridge";
export const DEFAULT_API_PORT = 8787;
export const DEFAULT_WEB_PORT = 5173;
