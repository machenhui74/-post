# GeoPost × 开源 GEO 对照分析

> 版本：V1.1  
> 日期：2026-08-20  
> 方法：对照 GeoPost 现有代码，逐仓阅读 GitHub 源码（不只 README）；V1.1 补了 LangGraph 节点、引用面板选择器、GEU/DSV-CF 量纲、GEORank 诊断口径等代码级事实  
> 结论先行：不要照抄任何一个仓库。GeoPost 已经占住了中国 GEO 最稀缺的一层——**用用户自己的登录态，把稿件填进官方编辑器**。真正该补的是测量闭环和可抽取事实块，不是再造一套 SaaS。

---

## 0. GeoPost 现在实际是什么

GeoPost（本仓库 `geopost`）不是「AI 可见性监测产品」，也不是学术 GEO 实验。它是：

```text
主题 / 母稿
    ↓  一次 Prompt 生成（apps/server/src/ai.ts + packages/rules/src/prompts.ts）
多平台独立稿 + 封面
    ↓  合规硬拦截（packages/rules/src/validate.ts + scan.ts）
Chrome 网关填入官方编辑器（apps/extension）
    ↓  永不点发布
人在编辑器里确认上线
```

已落地、且开源圈很少有人做成的能力：

| 能力 | 落点 | 备注 |
|---|---|---|
| 11 家中文发文站填表 | `apps/extension/src/fill.ts`、`saveDraft.ts` | 搜狐 / 网易 / 头条 / 知乎 / 企鹅 / CSDN / 掘金 / 博客园；微信、B站、百家号走存草稿 |
| Cookie 不出浏览器 | `apps/server/src/bridge.ts` | 本机控制台只分发，扩展在用户会话里填表 |
| 平台字数 / 封面 / 分类规则 | `packages/rules/src/platform-rules.json` | 已有 `geoOrder`、`styleHint` |
| 原创 / 首发 / 独家互斥 | `packages/rules/src/validate.ts` | 禁止全站勾原创、头条 AI 稿禁原创 |
| 红线扫描 | `packages/rules/src/scan.ts` | 导流、疗效承诺、荐股、标题党、新闻口吻 |
| Agent / MCP 填表 | `apps/server/src/agent.ts`、`mcp.ts` | Cursor Agent 可 dispatch，仍不点发布 |
| 信源优先级研究 | `国内主流 AI 平台 GEO 信源优先级排序.md` | 豆包偏字节、元宝偏腾讯、DeepSeek/Kimi 偏权威与长文 |

明确没有的能力：

- 向豆包 / DeepSeek / Kimi / 千问 / 元宝 **提问并解析引用**
- 品牌 Mention / Citation / Share of Voice
- 发文前的 **问题库**（用户会怎么问 AI）
- 发文后的 **前后对比验收**
- 改写候选 A/B/C + 忠实度门控
- 品牌事实卡（可被抽取的事实块，而不是整篇文章）
- JSON-LD / llms.txt（对官网有用，对门户号几乎无用）

一句话定位：**GeoPost = 中国 GEO 的分发执行层。** 开源圈里监测做得多、分发做得少。GeoLook 甚至明确拒绝接入头条 / 小红书 / B 站官方 API，理由是「宁缺毋假」。这恰好是 GeoPost 已经打通的护城河。

---

## 1. 总判断：开源 GEO 四条线，GeoPost 只该吃三条里的模块

```text
学术改写（怎么改网页让 AI 引用）     产品工作台（诊断/拓词/Schema）
  GEO / AutoGEO / MAGEO / AgenticGEO     GEORank
                    \                   /
                     \                 /
                      中国 GEO 闭环
                     /                 \
                    /                   \
真实采集（怎么拿到国内 AI 答案）     可见性监测（怎么算 Mention）
  geo-monitoring / GeoLook 插件         Elmo / GEO-Insight / GeoLook
```

对 GeoPost 的正确拼法：

```text
                          GeoPost 下一步
                                │
        ┌───────────────────────┼───────────────────────┐
        ↓                       ↓                       ↓
   内容怎么写才可被抽         发到哪家信源               AI 有没有引用
   AutoGEO 规则提取           已有 geoOrder + 信源表      Elmo 数据模型
   MAGEO 候选+门控            GeoLook 1.37% 官网结论      geo-monitoring 适配器
   GeoLook 事实块             C-SEO Bench：技巧会失效     GeoLook 问题库/验收
```

**不要**把 GeoPost 重写成 Next.js + FastAPI + PostgreSQL + Redis + Qdrant + Neo4j + MinIO（GEORank 那套）。本仓库已经是 pnpm monorepo + Hono + Chrome 扩展 + 本地 JSON store，增量加模块即可。

---

## 2. 对照总表（代码事实，不是宣传）

数据截至 2026-08-19 前后 GitHub API。Stars 只作参考，工程价值另评。

| 项目 | Stars | 协议 | 代码真实能力 | 对中国 GEO | 对 GeoPost 实质帮助 | 优先级 |
|---|---:|---|---|---|---|---|
| [GEO-optim/GEO](https://github.com/GEO-optim/GEO) | 320 | Apache-2.0 | 9 种 LLM 改写 + 引用可见性公式 | 理论 | 指标公式、策略名单 | 高（学公式） |
| [cxcscmu/AutoGEO](https://github.com/cxcscmu/AutoGEO) | 200 | MIT | 规则提取 → 改写 → GEO/GEU 双分 | 弱（Gemini/GPT/Claude） | **闭环评估思想** | 高 |
| [Wu-beining/MAGEO](https://github.com/Wu-beining/MAGEO) | 37 | 无 LICENSE | Preference/Planner/Editor/Evaluator + Fidelity Gate | 弱 | **多候选+忠实度门控** | 高 |
| [elmohq/elmo](https://github.com/elmohq/elmo) | 249 | MIT | Prompt 调度、Mention、Citation、SOV、可审计指标 | 无国内引擎 | **监测数据模型** | 高 |
| [yaojingang/GEORank](https://github.com/yaojingang/GEORank) | 408 | Apache-2.0 | 诊断/问答/拓词/JSON-LD/llms.txt/后台；Qdrant+Neo4j 真有代码 | 偏官网 | 产品信息架构，**不要抄栈** | 中 |
| GEO-Insight | 原仓 404 | README 标 MIT（fork 未见 LICENSE） | LangGraph **五节点线性图** + 博查搜网页 + DeepSeek **扮演**人设；零 Playwright | 叙事强、采集假 | 生态域名白名单、裁判 JSON 字段 | 低（勿当采样器） |
| [lhaovo/geo-monitoring](https://github.com/lhaovo/geo-monitoring) | 0 | 无 | Playwright 适配 DeepSeek/豆包/Kimi/千问/元宝，抽引用+截图 | **最高** | **采集架构参考** | 高 |
| [aigclink/geolook](https://github.com/aigclink/geolook) | 551 | MIT | 问题库、事实块、工单验收、Chrome 采样助手；发文几乎不做 | **最高（产品思想）** | **最该学的产品** | 最高 |
| [xxxbozzz/gitgeo](https://github.com/xxxbozzz/gitgeo) | ~20 | MIT | 9 维质检 + 探测写回；发布层用反检测浏览器 | 有 | 质检维度、反馈写回；**发布层不要抄** | 中 |
| [AIcling/agentic_geo](https://github.com/AIcling/agentic_geo) | 39 | Apache-2.0（README 误写 MIT） | **训练代码不在仓内**；只发了冻结 `strategies.json` + Critic 权重 | 弱 | 不造假的 short_prompt | 低 |
| [litonglab/CNGEO](https://github.com/litonglab/CNGEO) | — | 未标 | 600 中文题 + 8 策略 + CS/PAWS + Bootstrap | **科研最高** | 中文改写策略、统计口径 | 高（学方法） |
| [parameterlab/c-seo-bench](https://github.com/parameterlab/c-seo-bench) | — | — | 证明多数 GEO 技巧在多人采用后失效 | 理论 | **防止把产品做成「加 FAQ」** | 高（纠偏） |
| GEO-Content-Optimizer-Skill | — | MIT | 包装 GeoLook 的 Agent Skill | 中 | 可把 GeoPost MCP 做成同类 Skill | 低 |
| GEO Research Hub | — | — | 论文地图 | — | 长期跟踪入口 | 收藏 |

---

## 3. 逐仓：代码里到底有什么、GeoPost 能拿什么

### 3.1 GEO-optim/GEO —— 理论基座，策略名单要过滤

**真实结构**

```text
src/geo_functions.py     9 个改写函数
src/utils.py             impression_word / pos / wordpos / para
src/run_geo.py           GEO_METHODS 列表
geval_prompts/           主观 G-Eval
GEO-Bench/               benchmark
```

**指标（仓里不叫 GEO Score，函数名是 `impression_*`）**

- 从答案里用正则抽 `[1]` `[2]`；引用 **1-based**，累加用 `scores[cit-1]`
- `impression_word_count_simple`：被引用句的词数份额（token 长度 >2）
- `impression_pos_count_simple`：位置衰减 `exp(-i / (n-1))`
- `impression_wordpos_count_simple`：词数 × 位置（论文 Position-Adjusted Word Count）
- AutoGEO 把这三项打包成 GEO Score；注意 AutoGEO 的 Source 编号从 **0** 起，移植时必须和 Prompt 约定一致

**策略（`src/geo_functions.py`，真实函数名）**

| 函数 | 做什么 | GeoPost 能不能用 |
|---|---|---|
| `fluent_optimization_gpt` | 更流畅 | 可用 |
| `unique_words_optimization_gpt` | 更独特用词 | 慎用 |
| `authoritative_optimization_mine` | 更权威语气 | 可用，禁止「只有我们最真」营销腔 |
| `more_quotes_mine` | **明确允许假引语** | **禁止** |
| `citing_credible_sources_mine` | **允许发明信源** | **禁止** |
| `stats_optimization_mine` | **允许假统计数字** | **禁止** |
| `simple_language_mine` | 更易懂 | 可用（知乎/公众号） |
| `technical_terms_mine` | 更技术 | 可用（CSDN/掘金） |
| `seo_optimize_mine2` | 加新关键词 | 弱相关 |

论文报「可见性最高 +40%」的实验里，一部分策略依赖虚构权威信号。C-SEO Bench（NeurIPS 2025）后续证明：多数这类改写在多人同时采用后收益接近零，传统「让信源排进 LLM 上下文」更有效。

**对 GeoPost**：学公式，不学造假。`scan.ts` 应把「虚构引语 / 虚构百分比 / 虚构机构」加成硬警告。现有红线只拦疗效和荐股，拦不住 GEO 论文里那种「假权威」。

---

### 3.2 AutoGEO —— 最该学的优化算法思想

**真实结构**

```text
autogeo/extract_rules.py     从生成式引擎挖偏好规则
autogeo/rewriters/           用规则改写
autogeo/evaluate.py          vanilla vs api vs mini
autogeo/evaluation/evaluator.py
  GEO = { word, pos, wordpos }          # 几乎照抄 GEO impression_*
  GEU = citation_quality + quality_dimensions + keypoint_coverage
```

GEU 细节（`geu_score.py`，移植时别被变量名骗）：

- 引用 Precision：每条带引用的 claim 相对被引文档的 support ∈ {1, 0.5, 0}
- 引用 Recall：有引用的 claim / 全部 claim
- 答案质量六维 0–10：Clarity / Depth / Balance / Breadth / Support / Insightfulness
- **KPC 代码是 Contradicted/N（矛盾率）**，不是「要点覆盖精度」

核心不是「让 LLM 写一篇 GEO 文」，而是：

```text
观察引擎喜欢什么 → 抽出规则 → 按规则改写 → 再喂给引擎 → 同时看可见性(GEO)和答案有没有变差(GEU)
```

README 写得很清楚：换引擎或换领域必须重跑规则提取。AutoGEO Mini 要 A100 × 2 做 SFT+GRPO，**GeoPost 不要碰 Mini**。

改写侧真正值钱的是 `rewriters/core.py` 的 **Quality Guidelines**（`filtered_rules`），不是 GEO 那 9 个造假 Prompt：先结论、可核验出处、具体数字/型号、小标题列表、中立、去掉广告导航。接到 `prompts.ts` 当加分约束即可。Prompt 里「可以用任何手段提高被引用率」这句不要抄。

**对 GeoPost 的可接法**

当前 `generateSession()` 是一次生成结束。应改成：

```text
母稿
 → 候选 A（基线）
 → 候选 B（权威+结构+数字，且数字必须带来源）
 → 用问题库里的 5～10 题探测
 → 选 Mention 更高且事实未漂的版本再填表
```

规则提取可以对齐你们已有的信源表：豆包偏好头条生态、元宝偏好公众号、DeepSeek 偏好可核验长文。这比在 Gemini 上挖英文规则更有用。

---

### 3.3 MAGEO —— Agent 闭环的最小可用形态

**真实结构（README Code Map 与目录一致）**

```text
pipeline/geo_optimizer.py
agent/preference_agent.py
agent/planner_agent.py
agent/editor_agent.py
agent/evaluation_agent.py
evaluation/metrics.py              DSV-CF
evaluation/candidate_selector.py   Fidelity Gate
memory/memory_bank.py
```

**DSV-CF（`evaluation/metrics.py`）**

- SSV（可见/选择）：WLV 词级可见、DPA 位置衰减、CP 引用存在、SI 影响
- ISI（影响/可靠）：AA 归因、FA 忠实、KC 要点覆盖、AD 答案偏移
- `S = 0.5 * SSV + 0.5 * ISI - 0.5 * (10 - AA)`
- `candidate_selector.py`：FA < 6 直接丢；FA/AA 相对上一轮下降也丢；连续 2 轮不提升就停

移植坑（代码级，不要当产品 KPI）：

- 论文附录是 `γ(1-AA)`（AA∈[0,1]）；代码因 1–10 分制成 `γ(10-AA)`
- WLV/DPA 是 0–1 份额，CP/SI 是 1–10，直接平均会被 LLM 分主导
- Editor 注释写四个专家角色，**实际是一次 LLM 调用出 K 个候选**
- Memory 的 embedding 字段存在但未用（注释写 production 才上）
- 仓库 **无 LICENSE**

中文分词按字符、英文按 token，比 GEO 原论文更适合中文。保真门思想可接到 `validate.ts`；不要上 10 轮 × 2 候选 × 再模拟引擎。

**对 GeoPost**：不要上 4 个 LangGraph Agent。把「生成 2～3 个候选 + 忠实度门控 + 选一个填表」接到 `generateSession` 即可。Memory 用 `.data/` JSON 记「哪种结构在知乎/CSDN 更容易过校验」，足够。

无 LICENSE，商用引用要谨慎，学结构不拷代码。

---

### 3.4 Elmo —— 监测数据模型第一名

MIT，TypeScript + PostgreSQL + pg-boss + TanStack Start。引擎全是 ChatGPT / Claude / Perplexity / Gemini / AI Overviews，**没有国内平台**。

可审计口径（README 与方法论一致）：

1. 每个品牌一组 Prompt（用户会问的问题）
2. 定时对每个引擎跑一遍
3. 存原文、引用 URL、query fan-out
4. 用品牌名 / 别名 / 域名扫 Mention；对竞品同样扫
5. Visibility = 提及该品牌的 run 占比；SOV = 自己 vs 竞品

实现提醒：Elmo 的提及检测是 naive `includes()`。解析层应学 GeoLook `analyze_answer()`（别名、拉丁词边界、否定、题干品牌隔离），表结构仍用 Elmo。

**对 GeoPost**：不要部署 Elmo。把这 5 张逻辑表搬进 `.data/`：

```text
Brand { name, aliases[], domains[], products[] }
Prompt { text, intent, engineScope }     // 推荐/比较/替代/价格/风险/场景/品牌验证
Run { promptId, engine, rawAnswer, citations[], sampledAt, env }
Mention { runId, entity, hit, rank? }
Citation { runId, url, domain, category }  // own / competitor / portal / social / other
```

这和现有 `TopicSession` 正交：Session 管发稿，Brand/Prompt/Run 管验收。

---

### 3.5 GEORank —— 产品模块清单有用，技术栈过重

后端 `backend/app/services/` **确实有**：

- `keyword_expansion.py` 拓词（8 维：语义/场景/商业/榜单/评测/品牌/问答/技术）
- `vector_store.py` Qdrant、`graph_store.py` Neo4j
- `tasks/diagnose.py` 规则诊断：JSON-LD **检测**、Meta、内容结构、外链
- Celery Beat **每 30 天** `re_diagnose_all`，不是每日 AI 可见性监测
- `ai_client.py` OpenAI 兼容池

口径容易看错的两处：

- `citation_analysis` 是 **页面外链密度**（arxiv/gov/edu/zhihu…），不是 AI 回答里的引用
- JSON-LD / llms.txt **生成** 主要在静态前端 `dist/js/tools.js` 的模板函数；Next 的 tools 页是空壳

所以 README 不是纯画饼。但它服务的是 **官网诊断 + Schema + 公司目录 RAG**，不是门户号填表，也 **没有** brand/query/run/mention。

GeoLook `references/method.md` 给出的关键数字：**品牌官网只占国内 AI 引用的约 1.37%**。GEORank 把资源砸在官网上，对「让豆包引用你」边际收益低。GeoPost 已经按搜狐 → 网易 → 头条排序发稿，这条路更接近引用大盘。

**可借鉴**：30/60/90 方案结构、拓词（问题词而不是 SEO 词）、后台模块开关。  
**不要**：引入 Neo4j / MinIO / Celery / Traefik。官网 JSON-LD 留给 `website` checklist，不要做成主路径。

---

### 3.6 GEO-Insight —— README 大于实现，原仓已 404

`https://github.com/huanghfzhufeng/GEO-Insight` 当前 404。公开可见的是 fork：`zhaobaini/GEO-Insight`，README 指向 `24K-GA/GEO-Insight`。

README 画了四路平台 Agent。源码是 **一条线性五节点图**：

```text
dispatch → simulate → judge → aggregate → finalize
```

`simulate_single_universe()`：Bocha 搜（`site:` 拼 `ecosystems.yaml` 域名白名单）→ Jina 抽正文 → **同一个** `deepseek-chat` 按人设写「假回答」。零 Playwright、零各家聊天页、零各家原生 API。

`ecosystems.yaml` 三个「宇宙」只是域名过滤：

- kimi → zhihu / mp.weixin / 36kr
- doubao → toutiao / douyin / ixigua
- wenxin → baidu / baike / baijiahao

裁判分（`JudgeResult.calculate_score`）：未提及=0；提及则 `100-(rank-1)*15`，正面+10 / 负面-20 / 阴阳-15。这是 LLM 打分，不是真实可见性。

**对 GeoPost**：域名白名单和你们信源表同方向，但他们用它去**搜网页再演戏**；你们应改成**真问对应 AI**。不要把这套分数当监测数据。

---

### 3.7 geo-monitoring —— 国内采集工程价值最高（尽管 0 Star）

**真实结构**

```text
src/platforms/
  deepseek/ doubao/ kimi/ qwen/ yuanbao/
  base.js + index.js          适配器注册
src/citations.js              引用抽取（约 20KB，认真写过）
src/infrastructure/           Playwright + 证据文件
src/db/                       SQLite：品牌/问题/任务/回答/来源
data/profiles/<platform>/     登录态（gitignore）
```

能力与限制都写在 README 里，和代码一致：

- 豆包默认有头，其余默认可无头
- 同平台同时只跑一题；全局并发 1～6
- 验证码 / 登录过期 / 页面改版需要人重新 `npm run open:<platform>`
- 进程内队列，重启不恢复任务

**对 GeoPost 的关键启发：不要再开一条 Playwright 登录栈。**

GeoPost 扩展已经活在用户 Chrome 里。更顺的路径是给扩展加 **采样模式**（GeoLook `extension/` 就是这个思路）：打开豆包/Kimi 网页 → 填问题 → 人按回车 → 抽答案和引用 → POST 回 `127.0.0.1:8787`。

引用抽取（`src/citations.js`）是认真写过的，不是扫一遍 `a[href]`：

- 千问：点「N 篇来源」→ `[data-c="refer_panel"]` 的 `data-click-extra` JSON 取 url
- 元宝：底部「来源」文本链 + 弹出卡片 `data-url`/`data-idx`，还要翻页、关广告
- Kimi：点 `.ref-action`，滚侧栏直到条数对齐；`waitForAnswer` 看停止按钮，防流式未完当完成
- DeepSeek / 豆包：点「N 个网页 / 参考 N 篇资料」

品牌匹配目前只是子串计数，`recommendation: 'unknown'`，**没有情感**。解析层应改用 GeoLook 的 `analyze_answer()`。

geo-monitoring 的适配器和 `citations.js` 适合当「选择器会坏、引用 DOM 会变」的对照样本，而不是直接依赖。

---

### 3.8 GeoLook —— 对 GeoPost 产品思想帮助最大

551 Stars，MIT，单机 Python + 标准库 HTTP + Chrome 采样助手。核心判断写在 `SKILL.md`：

> GEO 的终点不是排名，是 AI 答案里那句话是不是按你的口径说的。  
> 最小单位不是页面，是可被抽取的事实块。

已实现且可复现：

| 模块 | 要点 |
|---|---|
| 七组问题库 | 推荐 / 比较 / 替代 / 价格 / 风险 / 品牌验证 / 场景；品牌验证题不计入提及率 |
| 意图分组 | 买家意图优先补内容 |
| 四层体检 | 访问 → 定向 → 理解 → 可引用 |
| 事实卡 | 每条标证据等级，抽不到标「待确认」，禁止常识填充 |
| 工单 | 依据 + 验收标准；能自动验收的不靠人口头说完 |
| Chrome 采样助手 | 侧栏填问题、一键抽引用；默人手按回车 |
| 发布边界 | 微信/WordPress 只到草稿；头条/小红书/B 站 **故意不接** |
| 采样纪律 | API ≠ 网页 ≠ App；千问 web/App 信源重合仅 24.5%；无原文不许标真实采样 |
| 提及解析 | `analyze_answer()`：别名、拉丁词边界、否定句剔除、题干品牌隔离 |

文档写了 DashScope / 元宝 / 文心 API，**`src/geolook/engines/sample.py` 实际只接 OpenAI 兼容（DeepSeek 等）**。Qwen/Yuanbao/Wenxin 走网页或未实现。这强化一条产品纪律：控制台必须把「API 参数知识」和「网页引用」分成两列，禁止合成一个分数。

**和 GeoPost 的互补是整张图里最重要的一点：**

```text
GeoLook：监测 + 诊断 + 工单 + 资产     （弱发布）
GeoPost：强发布（官方编辑器填表）       （无监测）
拼起来：事实块 → 按信源表填多家门户 → 采样看引用 → 下一轮改稿
```

GeoLook 的 `references/cn-source-ranking.md` 与你们 `国内主流 AI 平台 GEO 信源优先级排序.md` 同方向。应用层差异：他们用大盘引用修正分发；你们用 `geoOrder` 固定搜狐优先。下一步应让 **目标 AI 引擎反推勾选哪些发文站**，而不是永远同一套顺序。

---

### 3.9 gitgeo —— 工作流清楚，发布层有红线

完整链路：关键词 → 证据 → Prompt → 9 维质检 → 4 平台×2 端探测 → 反馈写回 → 内链 → 发布 → 审计。

9 维（README）：字数深度、H2、数据表、FAQ、参考文献、首句定义、违禁词、逻辑链、标题。低于 80 分返修最多 3 轮。

**不要抄：** `CloakBrowser`（Playwright + 反检测补丁）自动发布。GeoPost 产品原则是用户会话 + 不点发布。反检测自动发文与现有合规模型冲突，也不应出现在优化路线里。

**引用探测别抄：** `engine.py` 用 `http` 子串当「有引用」，误报极高。对照样本用 geo-monitoring 的面板选择器。

**可抄：** 探测结果写回下一轮 Prompt（未命中的「工程实践 / 官方文档」等标签变成约束）；能力记忆层（品牌可验证参数）。这和 MAGEO Memory、GeoLook 事实卡是同一类东西。

---

### 3.10 AgenticGEO —— 后期再看

README 写 MIT，仓库 `LICENSE` 是 **Apache-2.0**。`evolved/archive/strategies.json` + Critic LoRA 是冻结产物；**MAP-Elites 训练代码不在仓里**。推理时 top-25 策略、最多 3 步改写。指标仍是 GEO-Bench 的 word/pos。需要本地 Qwen 和 GPU。对当前 Hono 服务没有增量价值。产品化后如果要「科技稿用技术策略、本地生活用权威策略」，再抽策略档案思想。

---

### 3.11 CNGEO —— 中文实验里最干净的一套

600 题 × 6 领域；流水线 `00`～`07` 全部在仓里。

8 个中文改写策略（`prompts/rewrite_prompts/`）：

`fluency` / `statistics` / `cite_sources` / `structured_summary` / `quotation` / `authoritative` / `technical_terms` / `keyword_stuffing`

答案引用标记是中文 `【来源 1】`，不是 `[1]`。指标：

- CS：Citation Share
- PAWS：Position-Aware Weighted Share
- Visibility = `α * PAWS + (1-α) * CS`，默认 α=0.7
- 每条件 5 次重复，再做按题聚类的 Bootstrap（2000 次）

评测引擎是 **API**：DeepSeek、千问、豆包（方舟）、文心（千帆），不是网页端。GeoLook 已强调 API ≠ 网页。CNGEO 适合做「改写策略在模型侧有没有用」，不能替代豆包 App 真实引用。

**对 GeoPost：** 把 `structured_summary`（文首定义+要点）和 `technical_terms`（技术站）写进 `prompts.ts` 的平台差异；`keyword_stuffing` 不要用。统计数字必须带来源，不要用他们实验里可能存在的「假数字」设定。

---

### 3.12 C-SEO Bench —— 防止产品走偏

NeurIPS D&B 2025。结论对 GeoPost 几乎是设计约束：

1. 文献里很多 GEO 改写方法，换领域、换「多人同时优化」后 **基本无效**
2. 更有效的是传统动作：**让你的信源进入生成引擎的检索上下文**；代码里 `seo_baseline` 把文档排到上下文更前面，往往压过改写方法
3. 采用率上升后是零和：大家都加权威腔，没人占便宜
4. 引用顺序解析用 `\[(\d+)\]`，和 GEO 同族

这直接支持你们现在的产品选择——**往搜狐/网易/头条/公众号填高质量稿**，而不是给官网堆 Schema。监测存在的意义是验证「信源进了没有」，不是给客户一个从 40 涨到 60 的黑盒 GEO Score。

---

### 3.13 Skill 包装与研究地图

- `liangdabiao/GEO-Content-Optimizer-Skill`：三个 Skill，重量级那个就是 GeoLook。GeoPost 已有 MCP（`agent_spec` / `dispatch`）。以后可加 `probe_visibility`、`generate_question_bank`，不必另起 Skill 仓库。
- `Wu-beining/generative-engine-optimization-research-hub`：论文索引。后续可跟但 **不要写进 V1 产品**：GEOFlow、yao-geo-skills、geo-citation-lab、gego、geo_marketing、xanlens。
- `LLM-X-Factorer/awesome-geo-cn`：国内平台与项目跟踪入口。

---

## 4. GeoPost 能力缺口矩阵

| 能力 | 现状 | 开源里最好的参考 | 该不该做 |
|---|---|---|---|
| 多平台填表 | 已有，护城河 | GeoLook 故意不做 | **保持，继续打磨选择器** |
| 合规拦截 | 已有 | gitgeo 违禁词、MAGEO Fidelity | 补「禁止虚构信源/数字」 |
| 按站改写风格 | 一次 Prompt + styleHint | AutoGEO 规则、CNGEO 策略 | 升级为「事实块 + 平台模板」 |
| 品牌事实卡 | 无 | GeoLook facts.md | **P0** |
| 问题库 | 无，只有 topic | Elmo Prompt、GeoLook 七组 | **P0** |
| AI 答案采样 | 无 | geo-monitoring / GeoLook 插件 | **P0（用现有扩展，不新开 Playwright）** |
| Mention / Citation | 无 | Elmo 表结构 + GeoLook `analyze_answer` | **P0** |
| 发文后验收 | 无，job 只看填没填上 | GeoLook verify | **P1** |
| 多候选+门控 | 无 | MAGEO | **P1** |
| 目标引擎 → 勾选站点 | 固定 geoOrder | 你们自己的信源表 | **P1** |
| JSON-LD / llms.txt | 无 | GEORank / GeoLook | P2，仅 website |
| 向量库 / 图谱 | 无 | GEORank | **不做** |
| 反检测自动发布 | 明确不做 | gitgeo CloakBrowser | **永不做** |

---

## 5. 国外项目 vs 国内项目，落到 GeoPost 上的含义

国外（GEO / AutoGEO / Elmo）：优化的是 **英文网页在 ChatGPT/Perplexity 里的引用份额**，假设文档已经在检索集里。

国内（GeoLook / geo-monitoring / 你们的信源表）：先解决 **稿件出现在字节/腾讯/门户内容池**，再解决 **AI 网页端真实答案**。

因此 GeoPost 的壁垒顺序是：

1. 分发（已有）
2. 事实一致、可抽取（缺）
3. 按目标引擎选择信源（半有：geoOrder 还是全局的）
4. 用用户浏览器采样真实答案（缺）
5. 把采样写回下一轮生成（缺）

不是「再写 100 篇 GEO 文章」。

---

## 6. 最终建议：Clone 顺序 vs 真正该做的事

**值得读代码，按这个顺序：**

1. GeoLook `SKILL.md` + `references/method.md`（产品与口径）
2. geo-monitoring `src/platforms/` + `citations.js`（网页会坏成什么样）
3. Elmo README 方法论（表怎么建）
4. AutoGEO `extract_rules.py` + `evaluator.py`（闭环）
5. MAGEO `candidate_selector.py` + `metrics.py`（门控）
6. CNGEO `prompts/rewrite_prompts/` + `07_compute_visibility_metrics.py`（中文指标）
7. GEO `geo_functions.py`（知道哪些策略是造假）
8. C-SEO Bench 论文结论（纠偏）

**不建议作为产品底座去跑：** GEORank 全家桶、AutoGEO Mini、AgenticGEO、GEO-Insight 的「平行宇宙」叙事。

落地步骤见同目录《GEO优化落地文档》。

---

## 7. V1.1 源码复核（相对 V1.0）

三位对照研究（[研究学术GEO三仓](505035b0-742f-4dc5-bceb-a32c0cbd332e)、[研究国内GEO仓](c414b43c-0dbf-48f9-930a-ee8fd37f098f)、[研究产品监测仓](0e4ef8bc-f5c3-4f2d-af28-62683f9705aa)）把 README 和实现钉死后，主要更正：

- GEO-Insight 不是四路原生 Agent，是五节点博查+DeepSeek 演戏
- GEORank 的 citation 是页面外链；JSON-LD 生成多在前端模板；Celery 30 天再诊断
- GeoLook 文档里的千问/元宝/文心 API 并未全部实现；提及解析比 Elmo 认真
- AgenticGEO LICENSE 是 Apache-2.0，训练代码不在仓
- AutoGEO GEU 的 KPC 是矛盾率；Source 编号 0-based
- MAGEO DSV-CF 量纲混用、无 LICENSE、Editor 并非四次专家调用
- C-SEO：把文档排进检索上下文更前面，往往压过改写
- 填表扩展与采样扩展权限不要揉成一团
