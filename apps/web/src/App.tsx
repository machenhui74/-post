import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type {
  AccountInfo,
  AiProviderId,
  BrandProfile,
  ConfirmPreview,
  ContentQuestion,
  EditorOptionCatalog,
  EditorExtraField,
  EngineId,
  KnowledgeDoc,
  PlatformDraft,
  PlatformId,
  PlatformUiPrefs,
  PublishJob,
  TopicSession,
  ValidationResult,
} from "@geopost/shared";
import {
  AI_PROVIDER_IDS,
  CHECKLIST_IDS,
  ENGINE_IDS,
  ENGINE_LABELS,
  PLATFORM_IDS,
  PLATFORM_LABELS,
  isChecklistPlatform,
  isSaveDraftEditorPlatform,
} from "@geopost/shared";
import type { PlatformRule } from "@geopost/rules";
import { applyPlatformUiPrefs, categorySelectLabels, flattenCategoryLabels, snapshotPlatformUiPrefs, staticEditorCatalog, uiPrefsChanged } from "@geopost/rules";
import { api, assetUrl } from "./api";
import { FactsPanel } from "./FactsPanel";
import { MarkdownEditor } from "./MarkdownEditor";

function zhLen(s: string): number {
  return Array.from(s.trim()).length;
}

const MODEL_PREFS_KEY = "geopost.modelPrefs";
const PLATFORM_PREFS_KEY = "geopost.platformPrefs";
const LAST_PLATFORMS_KEY = "geopost.lastPlatforms";

/** 刷新后第一帧就停在上次选项，不必等 /api/settings。 */
function readLocalModelPrefs(): { provider: AiProviderId; model: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_PREFS_KEY) ?? "{}") as { provider?: unknown; model?: unknown };
    const provider = AI_PROVIDER_IDS.includes(raw.provider as AiProviderId)
      ? (raw.provider as AiProviderId)
      : "openai";
    return { provider, model: typeof raw.model === "string" ? raw.model : "" };
  } catch {
    return { provider: "openai", model: "" };
  }
}

function readLocalPlatformPrefs(): Partial<Record<PlatformId, PlatformUiPrefs>> {
  try {
    const raw = JSON.parse(localStorage.getItem(PLATFORM_PREFS_KEY) ?? "{}") as Partial<Record<PlatformId, PlatformUiPrefs>>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function mergeLocalPlatformPrefs(patch: Partial<Record<PlatformId, PlatformUiPrefs>>): void {
  try {
    localStorage.setItem(PLATFORM_PREFS_KEY, JSON.stringify({ ...readLocalPlatformPrefs(), ...patch }));
  } catch {
    /* 隐私模式可能禁写 */
  }
}

function readLocalLastPlatforms(): PlatformId[] | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_PLATFORMS_KEY) ?? "null") as unknown;
    if (!Array.isArray(raw)) return undefined;
    return raw.filter((id): id is PlatformId => (PLATFORM_IDS as readonly string[]).includes(id));
  } catch {
    return undefined;
  }
}

function writeLocalLastPlatforms(ids: PlatformId[]): void {
  try {
    localStorage.setItem(LAST_PLATFORMS_KEY, JSON.stringify(ids));
  } catch {
    /* 隐私模式可能禁写 */
  }
}

function defaultCatalogs(): Partial<Record<PlatformId, EditorOptionCatalog>> {
  return Object.fromEntries(PLATFORM_IDS.map((id) => [id, staticEditorCatalog(id)])) as Partial<
    Record<PlatformId, EditorOptionCatalog>
  >;
}

function applyLastPlatforms(session: TopicSession, ids: PlatformId[]): TopicSession {
  const allow = new Set(ids);
  const platforms = { ...session.platforms };
  for (const id of PLATFORM_IDS) {
    platforms[id] = { ...platforms[id], selected: allow.has(id) };
  }
  return { ...session, platforms };
}

function applyPrefsToSession(
  session: TopicSession,
  prefs: Partial<Record<PlatformId, PlatformUiPrefs>>,
  catalogs?: Partial<Record<PlatformId, EditorOptionCatalog>>,
): TopicSession {
  const platforms = { ...session.platforms };
  for (const id of PLATFORM_IDS) {
    platforms[id] = applyPlatformUiPrefs(
      platforms[id],
      prefs[id],
      flattenCategoryLabels(catalogs?.[id]?.categories),
    );
  }
  return { ...session, platforms };
}

export function App() {
  const [health, setHealth] = useState({ server: false, extension: false });
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountErr, setAccountErr] = useState("");
  /** 正在单独刷新的那一家；用来转右上角按钮。 */
  const [refreshingId, setRefreshingId] = useState<PlatformId | null>(null);
  const [catalogs, setCatalogs] = useState<Partial<Record<PlatformId, EditorOptionCatalog>>>(defaultCatalogs);
  const [rules, setRules] = useState<PlatformRule[]>([]);
  const [session, setSession] = useState<TopicSession | null>(null);
  const [topic, setTopic] = useState("");
  const [provider, setProvider] = useState<AiProviderId>(() => readLocalModelPrefs().provider);
  const [model, setModel] = useState(() => readLocalModelPrefs().model);
  /** oMLX 本机已装模型，选「本地 oMLX」时用来填下拉。 */
  const [omlxModels, setOmlxModels] = useState<string[]>([]);
  const [genImages, setGenImages] = useState(false);
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState<PlatformId>("sohu");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ConfirmPreview | null>(null);
  const [bjhAck, setBjhAck] = useState(false);
  const [job, setJob] = useState<PublishJob | null>(null);
  const [publishErr, setPublishErr] = useState("");
  const [issues, setIssues] = useState<ValidationResult | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [baikeUrl, setBaikeUrl] = useState("https://baike.baidu.com/");
  const [page, setPage] = useState<"write" | "facts">("write");
  const [brand, setBrand] = useState<BrandProfile>({
    name: "",
    aliases: [],
    domains: [],
    products: [],
    competitors: [],
    facts: [],
    updatedAt: "",
  });
  const [questions, setQuestions] = useState<ContentQuestion[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeDoc[]>([]);
  const [engines, setEngines] = useState<EngineId[]>([]);
  const [affinities, setAffinities] = useState<Partial<Record<EngineId, PlatformId[]>>>({});

  const ruleMap = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r])), [rules]);

  /**
   * 未登录打开 loginUrl；已登录/核对清单才走编辑或维护页。
   * 必须在 click 里同步 window.open，否则弹窗会被拦。
   */
  function openPlatformPage(id: PlatformId, intent: "login" | "editor" = "editor") {
    const rule = ruleMap[id];
    const url =
      id === "website"
        ? websiteUrl
        : id === "baike"
          ? baikeUrl
          : intent === "login"
            ? (rule?.loginUrl || rule?.editorUrl)
            : (rule?.editorUrl || rule?.loginUrl);
    if (!url) {
      setError(
        id === "website"
          ? "请先填写企业官网 URL"
          : `${PLATFORM_LABELS[id]} 没有配置${intent === "login" ? "登录" : "发布"}页地址`,
      );
      return;
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) setError("浏览器拦截了新标签，请允许本站弹出窗口");
  }

  function accountOf(id: PlatformId): AccountInfo | undefined {
    return accounts.find((a) => a.platform === id);
  }

  /**
   * 插件在线且已经探测到未登录 → 去登录页，不切右侧详情。
   * 插件未连或还没探完时仍打开稿面，避免写稿被卡死。
   */
  function onPlatformNameClick(id: PlatformId) {
    if (isChecklistPlatform(id)) {
      setTab(id);
      return;
    }
    if (health.extension && accounts.length > 0 && !accountOf(id)?.loggedIn) {
      openPlatformPage(id, "login");
      return;
    }
    setTab(id);
  }

  async function refreshHealth() {
    try {
      const h = await api.health();
      setHealth({ server: h.server, extension: h.extension && h.extensionPing });
    } catch {
      setHealth({ server: false, extension: false });
    }
  }

  async function refreshAccounts(spawn = false) {
    try {
      const res = await api.accounts(spawn);
      setAccounts(res.accounts);
      setAccountErr(res.error ?? "");
      if (res.catalogs?.length) {
        setCatalogs((cur) => {
          const next = { ...cur };
          for (const cat of res.catalogs ?? []) next[cat.platform] = cat;
          return next;
        });
      }
    } catch (err) {
      setAccountErr(err instanceof Error ? err.message : String(err));
    }
  }

  /** 右侧平台按钮右上角：只刷新这一家的登录态和发文可选项。 */
  async function refreshOnePlatform(id: PlatformId, ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    if (isChecklistPlatform(id)) return;
    if (!health.extension) {
      setAccountErr("扩展未连接，无法刷新该平台");
      return;
    }
    setRefreshingId(id);
    setAccountErr("");
    try {
      const res = await api.refreshAccount(id);
      setAccounts((cur) => {
        const rest = cur.filter((a) => a.platform !== id);
        return [...rest, res.account];
      });
      const cat = res.catalog;
      if (cat) setCatalogs((cur) => ({ ...cur, [id]: cat }));
    } catch (err) {
      setAccountErr(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingId(null);
    }
  }

  useEffect(() => {
    api.platforms().then((r) => {
      setRules(r.platforms);
      setAffinities(r.affinities ?? {});
    }).catch(() => undefined);
    api.editorOptions().then((r) => {
      setCatalogs((cur) => ({ ...cur, ...r.catalogs }));
    }).catch(() => undefined);
    api.settings().then((r) => {
      setWebsiteUrl(r.settings.websiteUrl);
      setBaikeUrl(r.settings.baikeUrl);
      setEngines(r.settings.targetEngines ?? []);
      // 服务端设置为准（换浏览器也能接上）；再写回 localStorage 避免下次闪默认项。
      const nextProvider =
        r.settings.lastProvider && AI_PROVIDER_IDS.includes(r.settings.lastProvider)
          ? r.settings.lastProvider
          : undefined;
      if (nextProvider) setProvider(nextProvider);
      if (typeof r.settings.lastModel === "string") setModel(r.settings.lastModel);
      if (nextProvider) {
        try {
          localStorage.setItem(
            MODEL_PREFS_KEY,
            JSON.stringify({ provider: nextProvider, model: r.settings.lastModel ?? "" }),
          );
        } catch {
          /* 隐私模式可能禁写 */
        }
      }
      if (r.settings.platformPrefs) {
        mergeLocalPlatformPrefs(r.settings.platformPrefs);
        setSession((cur) => (cur ? applyPrefsToSession(cur, r.settings.platformPrefs ?? {}) : cur));
      }
      if (Array.isArray(r.settings.lastPlatforms)) {
        writeLocalLastPlatforms(r.settings.lastPlatforms);
        setSession((cur) => (cur ? applyLastPlatforms(cur, r.settings.lastPlatforms ?? []) : cur));
      }
    }).catch(() => undefined);
    api.brand().then((r) => setBrand(r.brand)).catch(() => undefined);
    api.questions().then((r) => setQuestions(r.questions)).catch(() => undefined);
    api.knowledge().then((r) => setKnowledge(r.knowledge)).catch(() => undefined);
    api.createBlank()
      .then((r) => {
        let next = applyPrefsToSession(r.session, readLocalPlatformPrefs());
        const last = readLocalLastPlatforms();
        if (last) next = applyLastPlatforms(next, last);
        setSession(next);
      })
      .catch((err) => setError(String(err)));
    void refreshHealth();
    const t = setInterval(() => void refreshHealth(), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!health.extension) return;
    // 刚连上时给「有会话 Cookie」的后台开一次页再探，否则搜狐已登录也会显示去登录。
    void refreshAccounts(true);
    const onFocus = () => void refreshAccounts();
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => void refreshAccounts(), 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [health.extension]);

  useEffect(() => {
    if (provider !== "omlx") {
      setOmlxModels([]);
      return;
    }
    let cancelled = false;
    api
      .listModels("omlx")
      .then((r) => {
        if (cancelled) return;
        setOmlxModels(r.models);
        setModel((cur) => {
          // 优先沿用上次记下的名字；模型卸掉了才退回 oMLX 默认。
          const next = cur && r.models.includes(cur) ? cur : r.defaultModel || r.models[0] || cur;
          if (next && next !== cur) {
            persistModelChoice("omlx", next);
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setOmlxModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  /** 立刻写下拉，刷新后才能停在同一项。 */
  function persistModelChoice(nextProvider: AiProviderId, nextModel: string) {
    try {
      localStorage.setItem(MODEL_PREFS_KEY, JSON.stringify({ provider: nextProvider, model: nextModel }));
    } catch {
      /* 隐私模式可能禁写 */
    }
    void api.saveSettings({ lastProvider: nextProvider, lastModel: nextModel });
  }

  /** 分类/声明/右侧勾选一起记；勾选用完整列表，刷新后不会只恢复一家。 */
  function rememberUiPrefs(platforms: TopicSession["platforms"]) {
    const lastPlatforms = PLATFORM_IDS.filter((id) => platforms[id]?.selected);
    const platformPrefs = Object.fromEntries(
      PLATFORM_IDS.map((id) => [id, snapshotPlatformUiPrefs(platforms[id])]),
    ) as Partial<Record<PlatformId, PlatformUiPrefs>>;
    mergeLocalPlatformPrefs(platformPrefs);
    writeLocalLastPlatforms(lastPlatforms);
    void api.saveSettings({ lastPlatforms, platformPrefs });
  }

  async function runGenerate(
    topicText: string,
    questionIds: string[],
    source: "topic" | "random_question",
  ) {
    const platforms = PLATFORM_IDS.filter((id) => session?.platforms[id]?.selected);
    if (platforms.length === 0) {
      setError("请先在右侧勾选要生成的平台");
      return;
    }
    setBusy(`正在生成 ${platforms.length} 家分发稿…`);
    setError("");
    try {
      const res = await api.generate({
        topic: topicText,
        provider,
        model: model || undefined,
        generateImages: genImages,
        questionIds,
        knowledgeIds: knowledge.filter((d) => d.selected && d.markdown.trim()).map((d) => d.id),
        targetEngines: engines,
        platforms,
        source,
      });
      setSession(res.session);
      persistModelChoice(provider, model);
      rememberUiPrefs(res.session.platforms);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  /** 只按左侧主题框生成，不把问题库当选题。 */
  function onGenerateFromTopic() {
    const text = topic.trim();
    if (!text) {
      setError("请先输入主题");
      return;
    }
    void runGenerate(text, [], "topic");
  }

  /** 从勾选且有正文的问题里抽一题当选题，并回写到主题框方便核对。 */
  function onGenerateFromRandomQuestion() {
    const pool = questions.filter((q) => q.selected && q.text.trim());
    if (pool.length === 0) {
      setError("请先在「事实与问题」里勾选至少一道有正文的买家问题");
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (!picked) {
      setError("问题库抽题失败，请再试一次");
      return;
    }
    setTopic(picked.text);
    void runGenerate(picked.text, [picked.id], "random_question");
  }

  async function persist(next: TopicSession) {
    setSession(next);
    await api.patchSession(next.id, { master: next.master, topic: next.topic, platforms: next.platforms });
  }

  /** 右侧按钮上的勾选：改参与填入，不强迫切到该站改稿。 */
  function setPlatformSelected(id: PlatformId, selected: boolean) {
    if (!session?.platforms[id]) return;
    const next = { ...session.platforms[id], selected };
    const platforms = { ...session.platforms, [id]: next };
    void persist({ ...session, platforms });
    rememberUiPrefs(platforms);
  }

  /** 目标引擎只改默认勾选，不改已生成正文。 */
  async function applyEngines(next: EngineId[]) {
    setEngines(next);
    void api.saveSettings({ targetEngines: next });
    if (!session) return;
    const allow = new Set<PlatformId>();
    if (next.length === 0) {
      for (const r of rules) {
        if (r.defaultSelected && r.kind !== "checklist") allow.add(r.id);
      }
    } else {
      for (const e of next) {
        for (const id of affinities[e] ?? []) allow.add(id);
      }
    }
    const platforms = { ...session.platforms };
    for (const id of PLATFORM_IDS) {
      if (CHECKLIST_IDS.includes(id)) continue;
      platforms[id] = { ...platforms[id], selected: allow.has(id) };
    }
    await persist({ ...session, platforms, targetEngines: next });
    rememberUiPrefs(platforms);
  }

  async function onUpload(file: File) {
    if (!session) return;
    const res = await api.upload(session.id, file);
    setSession(res.session);
  }

  async function openConfirm() {
    if (!session) return;
    const picked = PLATFORM_IDS.filter((id) => session.platforms[id]?.selected);
    if (picked.length === 0) {
      setError("请先在右侧勾选要填入的平台");
      return;
    }
    setBusy("AI 按各站发文标准审核改稿中…");
    setError("");
    try {
      const c = await api.confirm(session.id, {
        isAutoPublish: false,
        provider,
        model: model || undefined,
      });
      if (c.session) setSession(c.session);
      setIssues(c.preview.issues);
      setPreview(c.preview);
      setBjhAck(false);
      setJob(null);
      setPublishErr("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function doPublish() {
    if (!preview) return;
    setBusy("填入中…");
    setPublishErr("");
    try {
      const res = await api.publish(preview.token, bjhAck);
      setJob(res.job);
      if (res.session) {
        setSession(res.session);
        rememberUiPrefs(res.session.platforms);
      }
      const opts = await api.editorOptions().catch(() => null);
      if (opts?.catalogs) setCatalogs((cur) => ({ ...cur, ...opts.catalogs }));
    } catch (err) {
      setPublishErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  const draft = session?.platforms[tab];
  const rule = ruleMap[tab];
  const pickedCount = session
    ? PLATFORM_IDS.filter((id) => session.platforms[id]?.selected).length
    : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">GEO<span>POST</span> 本地控制台</div>
        <div className="tabs nav-tabs">
          <button type="button" className={page === "write" ? "ghost active" : "ghost"} onClick={() => setPage("write")}>
            写稿
          </button>
          <button type="button" className={page === "facts" ? "ghost active" : "ghost"} onClick={() => setPage("facts")}>
            事实与问题
          </button>
        </div>
        <div className="status">
          <span><i className={`dot ${health.server ? "on" : "off"}`} />服务 {health.server ? "就绪" : "未启动"}</span>
          <span><i className={`dot ${health.extension ? "on" : "off"}`} />插件 {health.extension ? "已连接" : "未连接"}</span>
          {busy && <span>{busy}</span>}
        </div>
      </header>
      {!health.extension && (
        <div className="warn" style={{ padding: "8px 20px", borderBottom: "1px solid var(--line)" }}>
          插件未连接：打开 chrome://extensions → 开发者模式 → 加载已解压目录
          <code> apps/extension/.output/chrome-mv3 </code>
          ，加载后点「重新加载」。图标角标应为 ON。去登录会直接打开官方发布页，不依赖插件。
        </div>
      )}

      {page === "facts" ? (
        <FactsPanel
          brand={brand}
          questions={questions}
          knowledge={knowledge}
          topic={topic}
          provider={provider}
          model={model}
          onBrand={setBrand}
          onQuestions={setQuestions}
          onKnowledge={setKnowledge}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
        />
      ) : (
      <div className="workspace">
        <aside className="col">
          <h2>主题与素材</h2>
          <div className="field">
            <label>主题</label>
            <textarea rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="输入主题，各平台将差异化改写" />
          </div>
          <div className="field">
            <label>目标 AI（按信源亲和默认勾选发文站，可再手改）</label>
            <div className="engine-picks">
              {ENGINE_IDS.map((id) => {
                const on = engines.includes(id);
                return (
                  <label key={id} className={on ? "on" : ""}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const next = e.target.checked ? [...engines, id] : engines.filter((x) => x !== id);
                        void applyEngines(next);
                      }}
                    />
                    {ENGINE_LABELS[id]}
                  </label>
                );
              })}
            </div>
            <p className="count">
              问题库已勾选 {questions.filter((q) => q.selected && q.text.trim()).length} 道（随机生成用）
              {" · "}
              知识库 {knowledge.filter((d) => d.selected && d.markdown.trim()).length} 篇
              {brand.name ? ` · 事实卡 ${brand.name}` : " · 未填品牌名"}
            </p>
          </div>
          <div className="field">
            <label>模型</label>
            <div className="row">
              <select
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as AiProviderId;
                  setProvider(next);
                  persistModelChoice(next, model);
                }}
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="ollama">Ollama 本地</option>
                <option value="omlx">oMLX 本地</option>
                <option value="anthropic">Claude</option>
              </select>
              {provider === "omlx" && omlxModels.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => {
                    const next = e.target.value;
                    setModel(next);
                    persistModelChoice(provider, next);
                  }}
                >
                  {omlxModels.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={(e) => persistModelChoice(provider, e.target.value)}
                  placeholder={provider === "omlx" ? "oMLX 模型目录名" : "可选模型名"}
                />
              )}
            </div>
          </div>
          <label className="row" style={{ marginBottom: 12, fontSize: 13 }}>
            <input type="checkbox" checked={genImages} onChange={(e) => setGenImages(e.target.checked)} />
            AI 生图（需 .env 的 IMAGE_PROVIDER≠none，否则会报错；也可只本地上传）
          </label>
          <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
            <button
              className="primary"
              disabled={!topic.trim() || Boolean(busy) || pickedCount === 0}
              onClick={onGenerateFromTopic}
            >
              生成分发稿（{pickedCount} 家）
            </button>
            <button
              className="ghost"
              disabled={Boolean(busy) || pickedCount === 0 || questions.filter((q) => q.selected && q.text.trim()).length === 0}
              onClick={onGenerateFromRandomQuestion}
              title="从勾选的买家问题里随机抽一题当选题"
            >
              随机生成
            </button>
          </div>
          {error && <div className="err">{error}</div>}

          <h2 style={{ marginTop: 18 }}>GEO 维护（不自动发）</h2>
          <div className="field">
            <label>百科词条 URL</label>
            <input
              value={baikeUrl}
              onChange={(e) => setBaikeUrl(e.target.value)}
              onBlur={() => void api.saveSettings({ baikeUrl })}
            />
          </div>
          <div className="field">
            <label>企业官网 URL</label>
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              onBlur={() => void api.saveSettings({ websiteUrl })}
              placeholder="https://your-domain.com/article"
            />
          </div>
          <div className="accounts">
            {CHECKLIST_IDS.map((id) => (
              <div className="card" key={id}>
                <div className="meta">
                  <div className="name">{PLATFORM_LABELS[id]}</div>
                  <div className="sub">人工核对实体名/日期，不代提交</div>
                </div>
                <button className="ghost" onClick={() => openPlatformPage(id)}>去维护</button>
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: 18 }}>素材库</h2>
          <input type="file" accept="image/*" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload(f);
          }} />
          <div className="assets" style={{ marginTop: 8 }}>
            {session?.assets.map((a) => (
              <figure key={a.id}>
                <img src={assetUrl(a.filename)} alt={a.filename} />
                <figcaption>{a.id}</figcaption>
              </figure>
            ))}
          </div>
        </aside>

        <section className="col">
          <h2>母稿（改这里不会覆盖已生成的平台稿）</h2>
          {session && (
            <>
              <div className="field">
                <label>标题</label>
                <input
                  value={session.master.title}
                  onChange={(e) => void persist({ ...session, master: { ...session.master, title: e.target.value } })}
                />
              </div>
              <div className="field">
                <label>摘要</label>
                <textarea
                  rows={2}
                  value={session.master.summary}
                  onChange={(e) => void persist({ ...session, master: { ...session.master, summary: e.target.value } })}
                />
              </div>
              <MarkdownEditor
                value={session.master.markdown}
                onChange={(markdown) => void persist({ ...session, master: { ...session.master, markdown } })}
              />
            </>
          )}
        </section>

        <section className="col">
          <h2>
            平台稿
            <span className="count" style={{ marginLeft: 8, fontWeight: 400 }}>
              勾选 {pickedCount} 家参与填入
            </span>
            <button
              type="button"
              className="ghost"
              style={{ marginLeft: 8, padding: "2px 8px", fontSize: 11, fontWeight: 400 }}
              onClick={() => void refreshAccounts(true)}
            >
              刷新登录
            </button>
          </h2>
          {accountErr && <div className="warn" style={{ marginBottom: 8 }}>{accountErr}</div>}
          <div className="plat-tabs">
            {PLATFORM_IDS.map((id) => {
              const on = Boolean(session?.platforms[id]?.selected);
              const checklist = isChecklistPlatform(id);
              const acc = accountOf(id);
              const loggedIn = Boolean(acc?.loggedIn);
              const probed = health.extension && accounts.length > 0;
              const needLogin = !checklist && probed && !loggedIn;
              const accLine = checklist
                ? "核对"
                : !health.extension
                  ? "未探测"
                  : !probed
                    ? "探测中"
                    : loggedIn
                      ? `${acc?.name ?? "已登录"}${acc?.canPublish ? "" : " · 资料未齐"}`
                      : (acc?.detail ?? "未登录");
              return (
                <div
                  key={id}
                  className={`plat-tab${tab === id ? " active" : ""}${on ? " picked" : ""}${needLogin ? " need-login" : ""}${loggedIn ? " logged-in" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!session}
                    title={checklist ? "任务结束后打开维护页" : "参与本次填入"}
                    aria-label={`${PLATFORM_LABELS[id]}${checklist ? " 任务结束后打开维护页" : " 参与本次填入"}`}
                    onChange={(e) => setPlatformSelected(id, e.target.checked)}
                  />
                  {acc?.avatar ? <img className="plat-avatar" src={acc.avatar} alt="" /> : null}
                  <i
                    className={`acc-dot ${checklist ? "chk" : loggedIn ? "on" : probed ? "off" : "unk"}`}
                    title={accLine}
                  />
                  <button
                    type="button"
                    title={
                      needLogin
                        ? `${PLATFORM_LABELS[id]} 未登录，点击去登录`
                        : checklist
                          ? `${PLATFORM_LABELS[id]} 核对清单`
                          : `${PLATFORM_LABELS[id]} ${accLine}`
                    }
                    onClick={() => onPlatformNameClick(id)}
                  >
                    <span className="plat-name">
                      {PLATFORM_LABELS[id]}
                      {checklist ? "·核" : ""}
                    </span>
                    <span className="plat-acc">{accLine}</span>
                  </button>
                  {!checklist && (
                    <button
                      type="button"
                      className={`plat-refresh${refreshingId === id ? " spin" : ""}`}
                      disabled={refreshingId === id}
                      title={`刷新 ${PLATFORM_LABELS[id]} 登录态，并扫描官方发文页选项`}
                      aria-label={`刷新 ${PLATFORM_LABELS[id]}`}
                      onClick={(e) => void refreshOnePlatform(id, e)}
                    >
                      ↻
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {session && draft && rule && (
            <PlatformPane
              draft={draft}
              rule={rule}
              catalog={catalogs[tab]}
              assets={session.assets}
              onChange={(next) => {
                const prev = session.platforms[tab];
                const platforms = { ...session.platforms, [tab]: next };
                void persist({ ...session, platforms });
                if (uiPrefsChanged(prev, next)) rememberUiPrefs(platforms);
              }}
            />
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" disabled={!session || Boolean(busy) || pickedCount === 0} onClick={() => void openConfirm()}>
              填入官方编辑器（先审核 {pickedCount} 家）
            </button>
          </div>
          {issues && !issues.ok && (
            <div className="err" style={{ marginTop: 8 }}>
              {issues.errors.map((e) => <div key={e.code + e.message}>{e.message}</div>)}
            </div>
          )}
          {issues && issues.warnings.length > 0 && (
            <div className="warn" style={{ marginTop: 8 }}>
              {issues.warnings.map((e) => <div key={e.code + e.message}>{e.message}</div>)}
            </div>
          )}
        </section>
      </div>
      )}

      {preview && (
        <div className="modal-bg" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>填入确认</h2>
            <p className="sub" style={{ color: "var(--muted)", fontFamily: "IBM Plex Sans, sans-serif", fontSize: 13 }}>
              能填的站先填入官方编辑器；缺封面等站会把稿留在详情，补齐后可再单独填。填成功的站会清空勾选和正文。扩展不点发布。
            </p>
            {preview.reviews && preview.reviews.length > 0 && (
              <div className="review-list">
                {preview.reviews.map((r) => (
                  <div
                    key={r.platform}
                    className={r.action === "unfixed" ? "err" : r.action === "fixed" ? "warn" : "count"}
                  >
                    {PLATFORM_LABELS[r.platform]}：
                    {r.action === "pass" ? "审核通过" : r.action === "fixed" ? "已按标准改写" : "仍有问题"}
                    {r.notes.length ? ` — ${r.notes.join("；")}` : ""}
                  </div>
                ))}
              </div>
            )}
            <table>
              <thead>
                <tr><th>平台</th><th>标题</th><th>本次</th><th>动作</th><th>AI</th><th>原创</th><th>首发</th><th>独家</th></tr>
              </thead>
              <tbody>
                {preview.targets.map((t) => (
                  <tr key={t.platform} className={t.ready ? "" : "hold"}>
                    <td>{PLATFORM_LABELS[t.platform]}</td>
                    <td>{t.title}</td>
                    <td>{t.ready ? "填入" : `暂缓${t.holdReason ? `：${t.holdReason}` : ""}`}</td>
                    <td>
                      {t.saveDraftThenEdit
                        ? "存草稿并打开编辑页"
                        : isChecklistPlatform(t.platform)
                          ? "打开维护页"
                          : "填好停在编辑器"}
                    </td>
                    <td>{t.aiDeclared ? "是" : "否"}</td>
                    <td>{t.claimOriginal ? "是" : "—"}</td>
                    <td>{t.claimFirstPublish ? "是" : "—"}</td>
                    <td>{t.claimExclusive ? "是" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.issues.warnings.map((w) => <div className="warn" key={w.message}>{w.message}</div>)}
            {preview.targets.filter((t) => !t.ready).map((t) => (
              <div className="warn" key={`hold-${t.platform}`}>
                {PLATFORM_LABELS[t.platform]}暂缓，稿留在详情：{t.holdReason ?? "未就绪"}
              </div>
            ))}
            {preview.issues.errors
              .filter((e) => !e.platform)
              .map((e) => <div className="err" key={e.message}>{e.message}</div>)}
            {publishErr && <div className="err" style={{ marginTop: 8 }}>{publishErr}</div>}
            {preview.targets.some((t) => t.ready && t.platform === "baijiahao" && t.claimOriginal) && (
              <label className="row" style={{ margin: "12px 0" }}>
                <input type="checkbox" checked={bjhAck} onChange={(e) => setBjhAck(e.target.checked)} />
                我确认百家号原创勾选：误标可能永久取消原创权
              </label>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <button
                className="primary"
                disabled={preview.targets.filter((t) => t.ready).length === 0 || Boolean(busy)}
                onClick={() => void doPublish()}
              >
                确认填入（{preview.targets.filter((t) => t.ready).length} 家）
              </button>
              <button className="ghost" onClick={() => setPreview(null)}>取消</button>
            </div>
            {job && (
              <div className="job" style={{ marginTop: 16 }}>
                {job.results.map((r) => (
                  <div key={r.platform} className={r.ok ? "" : "err"}>
                    {PLATFORM_LABELS[r.platform]}：{r.ok ? "已填入" : "未填好"} — {r.message}
                    {r.editorOpened ? "（已打开官方编辑器）" : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlatformPane(props: {
  draft: PlatformDraft;
  rule: PlatformRule;
  catalog?: EditorOptionCatalog;
  assets: TopicSession["assets"];
  onChange: (d: PlatformDraft) => void;
}) {
  const { draft, rule, catalog, onChange } = props;
  const titleN = zhLen(draft.title);
  const bodyN = zhLen(draft.markdown);
  const categoryLabels = categorySelectLabels(rule.categories, catalog, draft.category);
  const summaryVisible = catalog ? catalog.summaryVisible : rule.summary.required;
  const summaryLabel = catalog?.summaryLabel ?? "摘要";
  const tagsVisible = Boolean(catalog?.tagsVisible || draft.tags.length);
  const extraFields: EditorExtraField[] = catalog?.extraFields?.length
    ? catalog.extraFields
    : catalog?.locationVisible
      ? [{
          label: catalog.locationLabel ?? "添加位置",
          kind: "search",
          placeholder: "标记城市，让更多同城用户看到",
          fillable: true,
        }]
      : [];
  const extraValue = (label: string): string => {
    if (/位置/.test(label)) return draft.location ?? draft.extras?.[label] ?? "";
    return draft.extras?.[label] ?? "";
  };
  const patchExtra = (label: string, value: string) => {
    const extras = { ...draft.extras, [label]: value };
    onChange({ ...draft, extras, location: /位置/.test(label) ? value : draft.location });
  };
  const toggles = catalog?.toggles ?? [
    { key: "aiDeclared" as const, label: "AI 声明", visible: true },
    { key: "claimOriginal" as const, label: "原创", visible: rule.supports.original },
    { key: "claimFirstPublish" as const, label: "首发", visible: rule.supports.firstPublish },
    { key: "claimExclusive" as const, label: "独家", visible: rule.supports.exclusive },
  ];
  return (
    <>
      {rule.kind === "publish" && rule.defaultSelected === false && (
        <p className="count" style={{ marginTop: 0 }}>该平台填表仍在适配，默认不参与。在上方按钮勾选后会打开官方编辑器尝试填入。</p>
      )}
      {rule.checklist && rule.checklist.length > 0 && (
        <ul className="count" style={{ paddingLeft: 18, marginTop: 0 }}>
          {rule.checklist.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      <div className="field">
        <label>标题 <span className={`count ${titleN > rule.title.max ? "over" : ""}`}>{titleN}/{rule.title.max}</span></label>
        <input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      </div>
      {summaryVisible && (
        <div className="field">
          <label>{summaryLabel} <span className="count">{zhLen(draft.summary)}/{rule.summary.max}</span></label>
          <textarea rows={2} value={draft.summary} onChange={(e) => onChange({ ...draft, summary: e.target.value })} />
        </div>
      )}
      {categoryLabels.length > 0 && (
        <div className="field">
          <label>分类{catalog?.source && catalog.source !== "static" ? "（已同步后台）" : ""}</label>
          <select value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value })}>
            {categoryLabels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      {tagsVisible && (
        <div className="field">
          <label>标签</label>
          <input
            value={draft.tags.join("，")}
            placeholder="逗号分隔"
            onChange={(e) =>
              onChange({
                ...draft,
                tags: e.target.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
              })
            }
          />
        </div>
      )}
      <div className="field">
        <label>封面（素材库，最多 {rule.cover.maxCount} 张）</label>
        {props.assets.length === 0 ? (
          <p className="count">先在左侧上传或生成图片</p>
        ) : (
          <div className="cover-picks">
            {props.assets.map((a) => {
              const checked = draft.coverAssetIds.includes(a.id);
              const locked = !checked && draft.coverAssetIds.length >= rule.cover.maxCount;
              return (
                <label key={a.id} className={checked ? "on" : ""}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...draft.coverAssetIds, a.id].slice(0, rule.cover.maxCount)
                        : draft.coverAssetIds.filter((id) => id !== a.id);
                      onChange({ ...draft, coverAssetIds: next });
                    }}
                  />
                  <img src={assetUrl(a.filename)} alt={a.filename} />
                  <button
                    type="button"
                    className="ghost"
                    onClick={(ev) => {
                      ev.preventDefault();
                      onChange({
                        ...draft,
                        markdown: `${draft.markdown.trim()}\n\n![配图](/api/assets/${a.filename})\n`,
                      });
                    }}
                  >
                    插入正文
                  </button>
                </label>
              );
            })}
          </div>
        )}
      </div>
      {extraFields.length > 0 && catalog?.source && catalog.source !== "static" && (
        <p className="count">以下项从官方发文页扫到，填入按标签点选。</p>
      )}
      {extraFields.map((field) => (
        <div className="field" key={field.label}>
          <label>{field.label}</label>
          {field.kind === "checkbox" ? (
            <label>
              <input
                type="checkbox"
                checked={extraValue(field.label) === "1"}
                disabled={!field.fillable}
                onChange={(e) => patchExtra(field.label, e.target.checked ? "1" : "")}
              />{" "}
              {field.placeholder || field.label}
            </label>
          ) : field.kind === "radio" && field.options?.length ? (
            <select
              value={extraValue(field.label)}
              disabled={!field.fillable}
              onChange={(e) => patchExtra(field.label, e.target.value)}
            >
              <option value="">不改官方默认</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              value={extraValue(field.label)}
              placeholder={field.placeholder || (field.fillable ? "选填" : "填入时不改")}
              disabled={!field.fillable}
              onChange={(e) => patchExtra(field.label, e.target.value)}
            />
          )}
          {!field.fillable && <p className="count">官方有这项，填入时不改默认，避免误开广告/合集。</p>}
          {field.fillable && field.kind === "search" && (
            <p className="count">选填。填入时按你填的内容在官方下拉里搜索点选。</p>
          )}
        </div>
      ))}
      <div className="checks">
        {toggles.filter((t) => t.visible).map((t) => (
          <label key={t.key}>
            <input
              type="checkbox"
              checked={Boolean(draft[t.key])}
              onChange={(e) => onChange({ ...draft, [t.key]: e.target.checked })}
            />{" "}
            {t.label}
          </label>
        ))}
        {isSaveDraftEditorPlatform(draft.platform) ? (
          <span className="count">该站只存草稿并打开官方编辑页，不会群发/上线</span>
        ) : (
          <span className="count">填完停在官方编辑器，请自己点发布</span>
        )}
      </div>
      <p className="count" style={{ margin: "8px 0" }}>{rule.styleHint} · 正文 {bodyN} 字</p>
      <MarkdownEditor value={draft.markdown} onChange={(markdown) => onChange({ ...draft, markdown })} />
    </>
  );
}
