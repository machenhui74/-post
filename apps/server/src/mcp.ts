import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = process.env.GEOPOST_API ?? "http://127.0.0.1:8787";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data: unknown = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * stdio MCP 只当客户端，真正执行仍在 :8787，与控制台同一套硬拦截。
 */
export async function startMcpStdio(): Promise<void> {
  const mcp = new McpServer({ name: "geopost", version: "0.1.0" });

  mcp.tool("agent_spec", "阅读本工具的完整调用契约，先于其他工具调用", {}, async () =>
    text(await api("/api/agent")),
  );

  mcp.tool("list_platforms", "列出各平台规则与入口", {}, async () => text(await api("/api/platforms")));

  mcp.tool("get_brand", "读取品牌事实卡", {}, async () => text(await api("/api/brand")));

  mcp.tool(
    "upsert_brand",
    "更新品牌事实卡。unknown 级事实禁止写进正文。",
    {
      name: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      domains: z.array(z.string()).optional(),
      products: z.array(z.string()).optional(),
      competitors: z.array(z.object({ name: z.string(), aliases: z.array(z.string()).optional() })).optional(),
      facts: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            value: z.string(),
            aliases: z.array(z.string()).optional(),
            evidence: z.string().optional(),
            grade: z.enum(["A", "B", "C", "D", "E", "unknown"]),
          }),
        )
        .optional(),
    },
    async (body) => text(await api("/api/brand", { method: "PATCH", body: JSON.stringify(body) })),
  );

  mcp.tool("list_questions", "列出买家问题库", {}, async () => text(await api("/api/questions")));

  mcp.tool("list_knowledge", "列出 Markdown 知识库（勾选篇会注入生成）", {}, async () =>
    text(await api("/api/knowledge")),
  );

  mcp.tool(
    "generate_drafts",
    "按主题生成母稿与勾选平台的独立稿。可带 platforms / questionIds / knowledgeIds / targetEngines。",
    {
      topic: z.string(),
      provider: z.enum(["openai", "ollama", "omlx", "anthropic"]).optional(),
      model: z.string().optional(),
      generateImages: z.boolean().optional(),
      questionIds: z.array(z.string()).optional(),
      knowledgeIds: z.array(z.string()).optional(),
      targetEngines: z.array(z.enum(["doubao", "yuanbao", "deepseek", "kimi", "wenxin", "qwen"])).optional(),
      platforms: z.array(z.string()).optional(),
    },
    async (body) => text(await api("/api/sessions", { method: "POST", body: JSON.stringify(body) })),
  );

  mcp.tool("check_auth", "探测各平台登录态（头像/昵称）", {}, async () => text(await api("/api/accounts")));

  mcp.tool(
    "confirm_publish",
    "生成填入预览与确认 token。永远只填表，不点官方发布。",
    {
      sessionId: z.string(),
      platforms: z.array(z.string()).optional(),
      mode: z.enum(["draft", "publish"]).optional(),
      isAutoPublish: z.boolean().optional(),
    },
    async ({ sessionId, platforms, mode, isAutoPublish }) =>
      text(
        await api(`/api/sessions/${sessionId}/confirm`, {
          method: "POST",
          body: JSON.stringify({ platforms, mode, isAutoPublish }),
        }),
      ),
  );

  mcp.tool(
    "publish",
    "使用 confirm token 填入官方编辑器。百家号勾原创需 baijiahaoOriginalAck。不点发布。",
    {
      token: z.string(),
      baijiahaoOriginalAck: z.boolean().optional(),
      isAutoPublish: z.boolean().optional(),
    },
    async (body) => text(await api("/api/publish", { method: "POST", body: JSON.stringify(body) })),
  );

  mcp.tool(
    "dispatch",
    "Agent 填入官方编辑器。platforms 为 all、单平台 id 或 id 数组。confirm 必须 true。内容三选一：sessionId / topic / title+markdown。不点发布；成功看填没填上。",
    {
      confirm: z.literal(true),
      platforms: z.union([z.literal("all"), z.string(), z.array(z.string()).min(1)]),
      mode: z.enum(["draft", "publish"]).optional(),
      isAutoPublish: z.boolean().optional(),
      sessionId: z.string().optional(),
      topic: z.string().optional(),
      title: z.string().optional(),
      markdown: z.string().optional(),
      summary: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      aiDeclared: z.boolean().optional(),
      claimOriginal: z.boolean().optional(),
      claimFirstPublish: z.boolean().optional(),
      claimExclusive: z.boolean().optional(),
      baijiahaoOriginalAck: z.boolean().optional(),
      provider: z.enum(["openai", "ollama", "omlx", "anthropic"]).optional(),
      model: z.string().optional(),
      generateImages: z.boolean().optional(),
      targetEngines: z.array(z.enum(["doubao", "yuanbao", "deepseek", "kimi", "wenxin", "qwen"])).optional(),
      questionIds: z.array(z.string()).optional(),
      coverBase64: z.string().optional(),
      coverMimeType: z.string().optional(),
    },
    async (body) => text(await api("/api/agent/dispatch", { method: "POST", body: JSON.stringify(body) })),
  );

  mcp.tool("get_job", "查询填入任务结果（ok=已填入编辑器，不是已上线）", { id: z.string() }, async ({ id }) => text(await api(`/api/jobs/${id}`)));

  await mcp.connect(new StdioServerTransport());
}
