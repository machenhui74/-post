import { createServer } from "node:http";
import { resolve } from "node:path";
import { config } from "dotenv";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { BRIDGE_PATH, DEFAULT_API_PORT } from "@geopost/shared";
import { attachBridge } from "./bridge.js";
import { logger } from "./logger.js";
import { startMcpStdio } from "./mcp.js";
import { createApp } from "./routes.js";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const port = Number(process.env.PORT ?? DEFAULT_API_PORT);

if (process.argv.includes("--mcp")) {
  startMcpStdio().catch((err) => {
    logger.error("mcp.fatal", { err: String(err) });
    process.exit(1);
  });
} else {
  const app = createApp();
  const server = createServer();
  const listener = getRequestListener(app.fetch);
  server.on("request", listener);

  const wss = new WebSocketServer({ noServer: true });
  attachBridge(wss);
  server.on("upgrade", (req, socket, head) => {
    if (req.url === BRIDGE_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }
    socket.destroy();
  });

  server.listen(port, "127.0.0.1", () => {
    logger.info("server.listen", {
      url: `http://127.0.0.1:${port}`,
      bridge: `ws://127.0.0.1:${port}${BRIDGE_PATH}`,
    });
  });
}
