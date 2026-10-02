/**
 * HTTP 侧也可拉起 MCP：`pnpm --filter @geopost/server start -- --mcp`
 * 与 UI 共用 generate / confirm / publish，避免 Agent 绕过硬拦截。
 */
export { startMcpStdio } from "./mcp.js";
