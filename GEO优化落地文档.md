# GeoPost GEO 优化落地文档

> 版本：V1.1  
> 日期：2026-08-20  
> 约束：基于现有 pnpm monorepo（`apps/web` + `apps/server` Hono + `apps/extension` + `packages/rules` + 本地 `.data/`）。不上 PostgreSQL / Redis / Qdrant / Neo4j。不点官方发布。不模拟登录、不绕过验证码。  
> 对照分析见《GEO开源对照分析》。V1.1 补了：API 与网页分列、提及解析、扩展权限隔离、AutoGEO 质量规则、C-SEO「检索位次 > 改写」。

---

## 0. 优化原则

1. **先测后改。** C-SEO Bench 表明多数「权威腔 / 假引用 / 堆关键词」在真实竞争里无效。没有采样，不许宣称 GEO 提升。
2. **最小单位是事实块，不是文章。** 各平台稿可以改结构，数字、日期、机构名、产品名必须来自同一张事实卡（对齐 GeoLook，也对齐现有 `prompts.ts` 第 5 条「事实口径一致」）。
3. **分发仍然是主路径。** 监测是为了告诉生成器和勾选器「这次有没有被引用」，不是做成 Elmo 的完整 SaaS。
4. **采样走现有 Chrome 网关。** 用户已登录豆包/Kimi 时，扩展抽答案；不要再维护一套 Playwright Profile。
5. **禁止学术 GEO 里的造假策略。** `more_quotes_mine`、`citing_credible_sources_mine`、`stats_optimization_mine` 明确允许假引语和假数字。写进 `scan.ts` 硬警告。
6. **API 采样和网页采样永远分列。** 现有 `ai.ts` 的 OpenAI 兼容调用最多当「参数知识」基线，标签必须写清；禁止和豆包/Kimi 网页引用合成一个可见性分数。GeoLook 实测千问 web/App 信源重合约 24.5%。
7. **填表与采样并行，不合并权限。** FillJob 只碰门户编辑器；ProbeJob 只碰 AI 聊天页。不要把两边 host_permissions 揉进一个「全能 content script」。

目标形态：

```text
事实卡 + 问题库
        ↓
按「目标 AI」勾选信源站（头条/公众号/搜狐…）
        ↓
生成：母稿 → 2～3 候选 → 忠实度门控 → 一版填表
        ↓
扩展填入官方编辑器（现有，不点发布）
        ↓
扩展采样：豆包/Kimi/DeepSeek/千问/元宝 网页答案
        ↓
Mention / Citation / 竞品 → 写回下一轮 Prompt
```

---

## 1. 阶段划分

| 阶段 | 目标 | 周期建议 | 用户可感知结果 |
|---|---|---|---|
| **P0** | 事实卡、问题库、禁造假、生成时注入可抽取块；可选「API 参数知识」基线（单独标注） | 1 个迭代 | 稿件有定义/数字/边界；能列出「要拿去问 AI 的题」 |
| **P1** | 扩展采样 + 可见性页 + 按目标引擎勾选平台 | 1～2 个迭代 | 发完能看到豆包有没有提到品牌 |
| **P2** | 多候选门控、探测写回、官网 llms.txt | 按需 | 自动选更可能被引的版本；官网资产可选 |

不要一上来做：定时全网监测、PDF 报告、多租户、知识图谱。

---

## 2. P0：让「发出去的稿」本身可被 AI 抽取

### 2.1 品牌事实卡

**为何：** GeoLook 证明 AI 抽的是段落级事实，不是整页营销文。现有生成只给 `topic` 字符串，各平台数字容易漂。

**数据**（可放 `packages/shared/src/models.ts`，存 `.data/brand.json`）：

```ts
/** 单条可核验事实。grade 对齐 GeoLook A–E，unknown 禁止写进正文。 */
export interface BrandFact {
  id: string;
  label: string;           // 例如「成立年份」「核心产品」
  value: string;
  aliases?: string[];      // 品牌错写、英文名，Mention 扫描要用
  evidence?: string;       // URL 或「待确认」
  grade: "A" | "B" | "C" | "D" | "E" | "unknown";
}

export interface BrandProfile {
  name: string;
  aliases: string[];
  domains: string[];
  products: string[];
  competitors: Array<{ name: string; aliases: string[] }>;
  facts: BrandFact[];
}
```

**改哪些文件**

- `apps/server/src/store.ts`：读写 `brand.json`（与 session 并列）
- `apps/server/src/routes.ts`：`GET/PATCH /api/brand`
- `apps/web/src/App.tsx`：侧栏或独立页编辑事实卡；`unknown` 高亮
- `packages/rules/src/prompts.ts`：`buildGeneratePrompt` 把 `facts` 塞进 system/user，并写死：

```text
只能使用事实卡里 grade 非 unknown 的条目。
禁止编造成立时间、客户名、百分比、奖项。
文首 80 字内必须有一句可独立抽取的定义（品牌是什么、服务谁、不服务谁）。
加分约束（AutoGEO Quality Guidelines，禁止「不择手段提高引用」）：
先结论；主张配可核验出处；具体数字/型号/步骤；一段一事；事实与观点分开。
```

**验收：** 同一 session 里搜狐稿和 CSDN 稿的产品名、数字一致；控制台能改一处事实、下次生成全站跟着变。

### 2.2 问题库（代替裸 topic）

**为何：** Elmo / GeoLook 的监测单位是 Prompt，不是文章标题。没有问题库，后续采样无法复现。

**数据**

```ts
export type QuestionIntent =
  | "recommend" | "compare" | "alternative"
  | "price" | "risk" | "scenario" | "brand";

export interface ProbeQuestion {
  id: string;
  intent: QuestionIntent;
  text: string;            // 口语，不要翻译腔
  engines: Array<"doubao" | "deepseek" | "kimi" | "qwen" | "yuanbao">;
  /** brand 类点名题，不算可见性，只算「说没说错」 */
  excludeFromVisibility: boolean;
}
```

生成方式 P0 用 LLM 从事实卡扩 15～25 题（每组 2～4），**必须人工勾选**再存。不要静默当指标。拓词维可参考 GEORank `keyword_expansion.py` 的 8 类（语义/场景/商业/榜单/评测/品牌/问答/技术），但产出必须是口语问题，不是 SEO 词堆。

GeoLook 纪律直接搬：`brand` 意图 `excludeFromVisibility: true`。

**改哪些文件**

- `packages/shared/src/models.ts` + store `questions.json`
- `packages/rules/src/prompts.ts` 增加 `buildQuestionBankPrompt(brand)`
- 控制台：问题库表格，按 intent 分组
- `generateSession` 可选接收 `questionIds`，把买家意图题写进各平台 FAQ 小节

**验收：** 主题「国产 PCB 阻抗控制」能产出「阻抗控制怎么做 / 和竞品比 / 多少钱 / 有哪些坑」，而不是 13 篇同构资讯。

### 2.3 平台稿强制可抽取块

在 `packages/rules/src/platform-rules.json` 为每个 `publish` 站增加（不破坏现有字段）：

```json
"extractBlocks": ["definition", "numbers", "comparison", "howto", "boundary", "faq"]
```

`styleHint` 不够强制。在 `validate.ts` 加 **警告**（先不要 error，避免老稿全军覆没）：

| 块 | 检测启发 | 优先平台 |
|---|---|---|
| definition | 首段 120 字内出现品牌正式名 | 全部 |
| numbers | 含数字且同句或脚注有来源 | 搜狐/网易/头条 |
| comparison | 表格或「相比」 | 知乎 |
| howto | 有序列步骤 | CSDN/掘金/博客园 |
| boundary | 「不适用于 / 不确定」 | 知乎/公众号 |
| faq | 至少 2 个问句小标题 | 百家号/官网提纲 |

依据：GeoLook 引用的实测——数字 / 定义 / 对比 / how-to 提升引用概率；纯 FAQ 外壳反而略负。所以 FAQ 是加分项，定义+数字才是硬项。

### 2.4 合规：封住学术 GEO 的造假口

改 `packages/rules/src/scan.ts`，新增（警告即可，P1 再升 error）：

```text
FAKE_STAT     百分比/倍数且无来源句（「据公开资料」也不够，要具体机构或「事实卡」）
FAKE_QUOTE    「XX 表示 / 据 XX 报告」但 XX 不在事实卡
UNIQUE_CLAIM  「全网唯一 / 只有我们最权威」类（与现有 CLICKBAIT 重叠可合并）
```

同时改 `SYSTEM_GUARD`：明确禁止虚构引语、虚构统计、虚构机构。这是对 GEO `geo_functions.py` 的负向清单。

### 2.5 生成仍一次 LLM，但输入变了

`apps/server/src/sessions.ts` 的 `generateSession`：

1. 读 brand + 选中的 questions
2. `buildGeneratePrompt(topic, brand, questions, extractBlocks)`
3. 解析后跑 `scanCopy` + 事实一致性（品牌正式名是否出现、unknown 事实是否漏进正文）

暂不上多候选，避免成本和产品复杂度一起涨。

### 2.6 可选：API「参数知识」基线（不要叫监测）

现有 `ai.ts` 已能调 OpenAI 兼容（DeepSeek / 千问等）。P0 可以用**同一批问题**打一列「模型是否记得品牌」，标签固定为 `source: api-parametric`。

用途：判断稿件上线前，模型内部知识里有没有你。**不能**和网页引用、信源域名混成一个 Visibility。控制台两列并排：参数知识 | 网页采样。缺一列就显示「未测」，禁止填 0 去平均。

---

## 3. P1：闭合「发出去 → AI 怎么说」

### 3.1 扩展增加采样模式（相对 Playwright 的正确增量）

现有扩展已经：探测登录（`probe.ts`）、填编辑器（`fill.ts`）、和本机 bridge 通信。

新增与发文对称的一类任务：

```text
FillJob     打开 mp.sohu.com 填稿
ProbeJob    打开 doubao.com / kimi 等，填问题，抽答案
```

**行为（对齐 GeoLook 默认，降低风控）：**

1. 控制台选问题 + 引擎
2. 扩展开已登录的 AI 站（用户平时就用的 Chrome 配置，不是无痕）
3. **人按回车发送**（默许；不要默认自动连发）
4. 等回答结束，抽：纯文本、引用链接、可选截图
5. POST `/api/probes` 存 `.data/probes.json`

平台适配放 `apps/extension/src/probeEngines/`，每个引擎一个文件，风格学 `fill.ts` 的分站函数，也学 geo-monitoring 的 adapter 注册，但跑在扩展里。

**权限隔离：** `fill.ts` 的 `matches` 只覆盖门户编辑器；`probeEngines` 只覆盖 AI 聊天页。后台消息类型分开（`FILL_*` / `PROBE_*`）。不要为了省事把豆包域名加进填表脚本，或把搜狐加进采样脚本。引用面板选择器对照 geo-monitoring `citations.js`（千问 `refer_panel`、元宝 `data-url`、Kimi `.ref-action`），当作会坏的样本，不要当稳定 SDK。

P1 引擎优先级（按你们信源表 + 网页可登录性）：

| 顺序 | 引擎 | 原因 |
|---|---|---|
| 1 | 豆包 | 字节生态，和头条号分发直接相关 |
| 2 | Kimi | 长文引用，和公众号/搜狐相关 |
| 3 | DeepSeek | 网页版相对稳定 |
| 4 | 千问 | 记住 web≠App |
| 5 | 元宝 | 和公众号/企鹅号相关 |

选择器会坏——这是 geo-monitoring README 的已知限制。把选择器集中在少量文件，坏了只改一处。

**不要做：** 自动打码、无头躲风控、共享 Profile、把 Cookie 传到 server。

### 3.2 Mention / Citation 解析（纯函数，可单测）

新包或 `packages/rules/src/visibility.ts`：

```ts
export function detectMentions(answer: string, brand: BrandProfile): {
  self: boolean;
  selfRankHint?: number;     // 首次出现位置
  competitors: string[];
  negated: boolean;          // 「不是 XX」简单启发，供人工复核
} { /* ... */ }

export function classifyCitation(url: string, brand: BrandProfile): "own" | "portal" | "competitor" | "social" | "other";
```

口径：表结构抄 Elmo（brand / prompt / run / mention / citation）；匹配算法抄 GeoLook `analyze_answer()`（别名、拉丁词边界、否定句剔除、题干已出现品牌则隔离）。不要用 Elmo 的 naive `includes()`，也不要用 gitgeo 的 `http` 子串当「有引用」。

机器结果必须能在 UI 里勾「人工覆盖」，重算指标。

门户域名表直接用你们信源文档：sohu.com、163.com、toutiao.com、zhihu.com、mp.weixin.qq.com、csdn.net … 用来验证「引用是不是落到我们刚发的那些站」。

### 3.3 可见性怎么算（先简单，可审计）

不要上 MAGEO 的 8 维 DSV-CF 给客户看（WLV/DPA 是 0–1，CP/SI 是 1–10，直接平均会被 LLM 分主导）。对内三列，禁止合成：

**层 A：业务可见性（网页采样，Elmo 风格）**

```text
visibility(engine) = 非 brand 题中，答案 Mention 品牌的比例
shareOfVoice        = selfMentions / (self + competitorMentions)
citationHit         = citations 域名落在自有域或本次已发门户
```

单次采样只作观察。GeoLook：连续两轮同向才叫趋势。UI 必须写「单轮有噪声」。

**层 B：科研可见性（可选，调试改写用）**

若答案带 `【来源 n】` 或 `[n]`，可复用 CNGEO 的 CS / PAWS，或 GEO `impression_wordpos` + MAGEO 中英混合分词。网页端常常没有这种标记——没有就显示「未测」，禁止编。引用编号必须与 Prompt 约定一致（GEO 1-based vs AutoGEO 0-based）。

**层 C：API 参数知识（P0 可选）**

独立列，永不参与层 A/B 的分母。

### 3.4 按目标引擎勾选发文站

现在 `geoOrder` 是全局搜狐第一。应变成：

```text
用户选目标引擎（可多选）
    ↓
读 国内主流 AI 平台 GEO 信源优先级排序.md 的矩阵
    ↓
默认勾选该引擎 S/A 级、且 GeoPost 已打通填表的站
```

例：

- 目标豆包 → 默认头条、搜狐、网易、知乎；公众号默认不勾
- 目标元宝 → 默认公众号、企鹅、搜狐、网易
- 目标 DeepSeek → 默认搜狐、网易、知乎、CSDN；百科/官网进 checklist

实现：`packages/rules` 增加 `engineAffinities: Record<EngineId, PlatformId[]>`，`agent.dispatch` 和确认预览用它做默认 `selected`，允许手改。

这比 JSON-LD 更能响应 C-SEO Bench：真正有效的是 **让信源进入引擎检索上下文**（代码里 `seo_baseline` 把文档排更前面，往往压过改写方法），不是再堆权威腔。

### 3.5 控制台：发稿旁加「探测」页

`apps/web` 不要做成 GEORank 频道森林。三个页就够：

1. **写稿 / 填表**（现有）
2. **事实与问题**（P0）
3. **探测**（P1）：选问题、开扩展、看 Mention 表、点进原文

健康检查沿用 `/api/health` 的 extensionPing。

### 3.6 MCP 增量

`apps/server/src/mcp.ts` 加工具（仍走 :8787 硬拦截）：

- `get_brand` / `upsert_fact`
- `list_questions`
- `probe_spec`（说明书，像现在的 `agent_spec`）
- `ingest_probe` 一般由扩展调用，不必给 Agent 自动连发

Agent 可以「先探测再决定发哪几家」，但发送按钮仍在人这边。

---

## 4. P2：生成侧闭环与薄资产

### 4.1 两到三个候选 + 忠实度门控

对齐 MAGEO `candidate_selector.py` 的精神，实现要小：

只对最可能被国内 AI 当信源的站做（官网提纲 / 知乎 / 公众号），不要 11 站各出 3 版。

1. 候选 A：当前生成器输出  
2. 候选 B：同一事实卡，强制 definition + numbers + boundary  
3. 可选 C：更技术（仅当勾了 CSDN/掘金）

门控接到 `validate.ts`（对齐 MAGEO `is_safe_enough`，但不要用未校准的 FA≥6 LLM 分）：

- 事实卡条目是否被删改（数字/机构/日期用正则+字符串包含，程序能做的先做）
- `scanCopy` 是否新出现 FAKE_STAT
- 若已有基线探测：Mention 未下降才采纳 B/C

成功改写记 `{platform, edit_type, op_pattern, validate_ok}` 到 `.data/`，几周后就是按平台的模式账本（搜狐/知乎/公众号），不要上向量库。

停：最多 2 轮。对齐 MAGEO patience，避免烧 token。

**不要**接 AutoGEO Mini / AgenticGEO LoRA。

### 4.2 探测写回 Prompt（gitgeo 的有用部分）

把最近一次探测里：

- 竞品被提到而自己没有 → 下一轮必须有对比块
- 引用域名全是竞品站 → 下一轮提高对应门户的 `selected` 权重
- 答案把品牌归错行业 → P0 改事实卡和定义句

存 `/.data/insights.json` 几条结构化笔记即可，不必向量库。

### 4.3 官网 llms.txt / JSON-LD

仅当 `website` checklist 有 URL 时生成，放到控制台下载，不自动部署。GEORank 的生成逻辑主要在静态前端模板（`dist/js/tools.js`），Next 工具页是空壳——抄口径即可，不要引入其后端诊断栈。对门户号发布路径价值低，故放 P2。

### 4.4 定时

本机可用系统 crontab 调 MCP/HTTP「导出本周买家意图题」。不要在 Node 进程里做 geo-monitoring 那种重启即丢的队列当核心。

---

## 5. 明确不做

| 项 | 原因 |
|---|---|
| 重写为 FastAPI + Next + PG + Neo4j | 与现有栈重复，官网诊断不是主战场 |
| Playwright 独立登录国内 AI | 与扩展双栈；Profile 锁和验证码成本高 |
| CloakBrowser / 反检测自动发布 | 违反「不点发布 + 用户会话」 |
| 虚构引语和假统计 | GEO 原论文策略；scan 要拦 |
| 把 GEO Score 40→60 当交付 | 无原文、无对照、无重复采样则不可审计 |
| 默认自动连发采样 | 平台 ToS 与风控；GeoLook 也把自动跑做成显式 opt-in |
| 用博查+DeepSeek 假装「采了豆包」 | GEO-Insight 五节点演戏；零 Playwright、零各家聊天页 |
| 把 API 提及率与网页引用合成一个分 | GeoLook：API ≠ 网页 ≠ App |
| 把 Fill 与 Probe 的 host_permissions 揉在一起 | 权限面过大；选择器互相污染 |
| DSV-CF / 单一 GEO Score 当客户 KPI | 量纲混用、无原文不可审计 |
| AutoGEO Mini / GRPO / AgenticGEO 训练 | GPU 研究附件；训练代码甚至不在仓 |
| 把文档里未实现的千问/元宝 API 当已采样 | GeoLook `sample.py` 实际只接 OpenAI 兼容 |

---

## 6. 建议的代码落点一览

```text
packages/shared/src/models.ts          BrandProfile, ProbeQuestion, ProbeRun
packages/rules/src/prompts.ts          注入事实卡、问题、抽取块、质量规则
packages/rules/src/scan.ts             FAKE_STAT / FAKE_QUOTE
packages/rules/src/visibility.ts       新建：Mention / Citation（GeoLook 算法）
packages/rules/src/platform-rules.json extractBlocks, engineAffinities
packages/rules/src/validate.ts         抽取块警告 + 相对母稿数字/机构/日期
packages/rules/src/geo-guidelines.json 可选：AutoGEO 风格 filtered_rules
apps/server/src/store.ts               brand.json questions.json probes.json
apps/server/src/sessions.ts            generateSession 读事实卡
apps/server/src/routes.ts              /api/brand /api/questions /api/probes
apps/server/src/mcp.ts                 只读+受控写入
apps/extension/src/probeEngines/*      新建
apps/extension/entrypoints/background.ts  增加 probe 消息
apps/web/src/App.tsx                   三页：写稿 / 事实问题 / 探测
```

日志继续走现有 Winston 封装 `apps/server/src/logger.ts`：`brand.save`、`probe.start`、`probe.parsed`、`visibility.recomputed`。

---

## 7. 验收清单（做到这些就算闭环成立）

**P0**

- [ ] 改事实卡一处数字，重新生成后 11 家稿数字一致
- [ ] unknown 事实出现在正文时有警告
- [ ] 每篇发文站稿文首有定义句
- [ ] 问题库至少覆盖推荐/比较/风险三类，brand 题标记不计入可见性
- [ ] 若做了 API 基线：控制台标明「参数知识」，且不能和网页列平均

**P1**

- [ ] 用户已登录豆包时，扩展能抽回答原文和引用 URL 回本机
- [ ] 探测页能看到 self mention、竞品、引用域名分类
- [ ] 选「目标：元宝」时默认勾选公众号+企鹅，而不是头条优先
- [ ] 无原文的 run 不能标「已监测」
- [ ] 填表 content script 的 matches 不含豆包/Kimi；采样 script 不含搜狐编辑器

**P2**

- [ ] 候选 B 因删除事实卡条目被门控丢弃
- [ ] 上一轮豆包只引竞品站时，下一轮默认加强对应门户勾选
- [ ] 官网 URL 可下载 llms.txt，门户填表路径不受影响

---

## 8. 和现有文档的关系

- `国内主流 AI 平台 GEO 信源优先级排序.md`：升为 **运行时数据**（`engineAffinities`），不要只当调研笔记。
- `发布按钮点击修改说明.md`：产品继续「只填表」。探测模式同样不代替用户按发送（除非以后单独做 opt-in，且须写清风险）。
- 本文件只规划增量；不要求先 Clone 任何开源仓库到本 monorepo。需要对照时读《GEO开源对照分析》里的文件路径即可。

---

## 9. V1.1 相对 V1.0

- P0 增加可选 API 参数知识列，禁止与网页可见性合成
- 提及解析改为 GeoLook 算法，不用 Elmo `includes()`
- 问题库拓词参考 GEORank 8 维，产出仍是口语题
- 生成 Prompt 注入 AutoGEO 质量规则（禁止「不择手段」）
- 填表/采样扩展权限隔离
- 多候选只覆盖高价值站；保真门走 `validate.ts` 程序检查
- 明确不做：混分、DSV-CF 当 KPI、未实现的引擎 API
