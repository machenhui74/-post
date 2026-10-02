import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import winston from "winston";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../.data");
mkdirSync(root, { recursive: true });

/**
 * 集中日志：控制台看流程，文件留审计。级别按连接/任务/失败区分。
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "geopost-server" },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${String(timestamp)} ${level} ${String(message)}${extra}`;
        }),
      ),
    }),
    new winston.transports.File({ filename: join(root, "server.log") }),
    new winston.transports.File({ filename: join(root, "audit.log"), level: "info" }),
  ],
});
