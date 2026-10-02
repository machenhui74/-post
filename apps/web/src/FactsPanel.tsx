import { useState } from "react";
import {
  QUESTION_INTENT_LABELS,
  QUESTION_INTENTS,
  type AiProviderId,
  type BrandFact,
  type BrandProfile,
  type ContentQuestion,
  type FactGrade,
  type KnowledgeDoc,
  type QuestionIntent,
} from "@geopost/shared";
import { api } from "./api";

const GRADES: FactGrade[] = ["A", "B", "C", "D", "E", "unknown"];

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function csv(s: string): string[] {
  return s.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
}

function emptyKnowledge(): KnowledgeDoc {
  return {
    id: nid("kb"),
    title: "",
    markdown: "",
    selected: true,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 事实卡、买家问题、Markdown 知识库。勾选的知识库会注入生成 Prompt。
 */
export function FactsPanel(props: {
  brand: BrandProfile;
  questions: ContentQuestion[];
  knowledge: KnowledgeDoc[];
  topic: string;
  provider: AiProviderId;
  model: string;
  onBrand: (b: BrandProfile) => void;
  onQuestions: (q: ContentQuestion[]) => void;
  onKnowledge: (k: KnowledgeDoc[]) => void;
  busy: string;
  setBusy: (s: string) => void;
  setError: (s: string) => void;
}) {
  const { brand, questions, knowledge, onBrand, onQuestions, onKnowledge } = props;
  const [localErr, setLocalErr] = useState("");
  const kbPicked = knowledge.filter((d) => d.selected && d.markdown.trim());
  const hasFactSource = Boolean(
    brand.name.trim() || brand.products.some((p) => p.trim()) || brand.facts.some((f) => f.grade !== "unknown" && f.value.trim()),
  );

  async function persistBrand(next: BrandProfile) {
    onBrand(next);
    await api.saveBrand(next);
  }

  /**
   * 勾选写进 questions.json，刷新后仍是上次那批，不必另存一份名单。
   */
  async function persistQuestions(next: ContentQuestion[]) {
    onQuestions(next);
    await api.saveQuestions(next);
  }

  /** 勾选与正文一并落盘，生成只吃 selected 且有 Markdown 的篇。 */
  async function persistKnowledge(next: KnowledgeDoc[]) {
    onKnowledge(next);
    await api.saveKnowledge(next);
  }

  /**
   * 问题从事实卡 + 当前勾选知识库一起出；两侧都空就拦下，避免空转编造。
   */
  async function onGenerateQuestions() {
    if (!hasFactSource && kbPicked.length === 0) {
      const msg = "请先填写事实卡，或勾选至少一篇有正文的知识库";
      setLocalErr(msg);
      props.setError(msg);
      return;
    }
    props.setBusy("从事实卡与知识库生成问题…");
    setLocalErr("");
    props.setError("");
    try {
      // 先落盘，生成按 id 读知识库正文，避免刚勾选还没写入。
      await persistKnowledge(knowledge);
      const res = await api.generateQuestions({
        topic: props.topic || undefined,
        provider: props.provider,
        model: props.model || undefined,
        knowledgeIds: kbPicked.map((d) => d.id),
      });
      onQuestions(res.questions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalErr(msg);
      props.setError(msg);
    } finally {
      props.setBusy("");
    }
  }

  function patchFact(id: string, patch: Partial<BrandFact>) {
    void persistBrand({
      ...brand,
      facts: brand.facts.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }

  function patchKnowledge(id: string, patch: Partial<KnowledgeDoc>) {
    void persistKnowledge(
      knowledge.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d)),
    );
  }

  function importMarkdownFiles(files: FileList | null) {
    if (!files?.length) return;
    const readers = Array.from(files).map(
      (file) =>
        new Promise<KnowledgeDoc>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const text = typeof reader.result === "string" ? reader.result : "";
            const stem = file.name.replace(/\.md$/i, "");
            resolve({
              id: nid("kb"),
              title: stem,
              markdown: text,
              selected: true,
              updatedAt: new Date().toISOString(),
            });
          };
          reader.onerror = () => reject(reader.error ?? new Error("读取失败"));
          reader.readAsText(file, "utf-8");
        }),
    );
    void Promise.all(readers)
      .then((docs) => persistKnowledge([...knowledge, ...docs]))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLocalErr(msg);
        props.setError(msg);
      });
  }

  return (
    <div className="workspace facts-workspace">
      <section className="col">
        <h2>品牌事实卡</h2>
        <p className="count" style={{ marginTop: 0 }}>
          各平台数字/机构/日期必须来自这里。grade=unknown 禁止入文。
        </p>
        <div className="field">
          <label>正式名</label>
          <input value={brand.name} onChange={(e) => void persistBrand({ ...brand, name: e.target.value })} />
        </div>
        <div className="field">
          <label>别名（顿号或逗号分隔）</label>
          <input
            value={brand.aliases.join("、")}
            onChange={(e) => void persistBrand({ ...brand, aliases: csv(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>产品</label>
          <input
            value={brand.products.join("、")}
            onChange={(e) => void persistBrand({ ...brand, products: csv(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>域名</label>
          <input
            value={brand.domains.join("、")}
            onChange={(e) => void persistBrand({ ...brand, domains: csv(e.target.value) })}
          />
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="ghost"
            type="button"
            onClick={() =>
              void persistBrand({
                ...brand,
                facts: [
                  ...brand.facts,
                  { id: nid("fact"), label: "", value: "", evidence: "", grade: "C" },
                ],
              })
            }
          >
            加一条事实
          </button>
        </div>
        {brand.facts.map((f) => (
          <div key={f.id} className={`fact-row ${f.grade === "unknown" ? "unknown" : ""}`}>
            <input placeholder="标签，如成立年份" value={f.label} onChange={(e) => patchFact(f.id, { label: e.target.value })} />
            <input placeholder="值" value={f.value} onChange={(e) => patchFact(f.id, { value: e.target.value })} />
            <input placeholder="出处 URL / 报告名" value={f.evidence ?? ""} onChange={(e) => patchFact(f.id, { evidence: e.target.value })} />
            <select value={f.grade} onChange={(e) => patchFact(f.id, { grade: e.target.value as FactGrade })}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <button
              className="ghost"
              type="button"
              onClick={() => void persistBrand({ ...brand, facts: brand.facts.filter((x) => x.id !== f.id) })}
            >
              删
            </button>
          </div>
        ))}
      </section>
      <section className="col">
        <h2>买家问题库</h2>
        <p className="count" style={{ marginTop: 0 }}>
          可从事实卡和勾选的知识库一起生成。勾选会立刻写入，刷新后仍是上次那批。随机生成只从勾选题里抽一道当选题。
        </p>
        <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          <button
            className="primary"
            type="button"
            disabled={Boolean(props.busy)}
            title={
              !hasFactSource && kbPicked.length === 0
                ? "请先填写事实卡或勾选知识库"
                : `将用事实卡${kbPicked.length ? ` + ${kbPicked.length} 篇知识库` : ""}`
            }
            onClick={() => void onGenerateQuestions()}
          >
            从事实卡与知识库生成
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() =>
              void persistQuestions([
                ...questions,
                {
                  id: nid("q"),
                  intent: "recommend",
                  text: "",
                  selected: true,
                  excludeFromVisibility: false,
                },
              ])
            }
          >
            手工加一题
          </button>
          <button
            className="ghost"
            type="button"
            disabled={questions.length === 0}
            onClick={() => void persistQuestions(questions.map((q) => ({ ...q, selected: true })))}
          >
            全选
          </button>
          <button
            className="ghost"
            type="button"
            disabled={questions.length === 0}
            onClick={() => void persistQuestions(questions.map((q) => ({ ...q, selected: false })))}
          >
            反全选
          </button>
        </div>
        <p className="count">已选 {questions.filter((q) => q.selected).length} / {questions.length}</p>
        {localErr && <div className="err">{localErr}</div>}
        {questions.map((q) => (
          <div key={q.id} className="q-row">
            <input
              type="checkbox"
              checked={q.selected}
              onChange={(e) =>
                void persistQuestions(questions.map((x) => (x.id === q.id ? { ...x, selected: e.target.checked } : x)))
              }
            />
            <select
              value={q.intent}
              onChange={(e) => {
                const intent = e.target.value as QuestionIntent;
                void persistQuestions(
                  questions.map((x) =>
                    x.id === q.id
                      ? { ...x, intent, excludeFromVisibility: intent === "brand" ? true : x.excludeFromVisibility }
                      : x,
                  ),
                );
              }}
            >
              {QUESTION_INTENTS.map((i) => (
                <option key={i} value={i}>
                  {QUESTION_INTENT_LABELS[i]}
                </option>
              ))}
            </select>
            <input
              value={q.text}
              placeholder="口语问题"
              onChange={(e) =>
                void persistQuestions(questions.map((x) => (x.id === q.id ? { ...x, text: e.target.value } : x)))
              }
            />
            <button
              className="ghost"
              type="button"
              onClick={() => void persistQuestions(questions.filter((x) => x.id !== q.id))}
            >
              删
            </button>
          </div>
        ))}
      </section>
      <section className="col">
        <h2>知识库</h2>
        <p className="count" style={{ marginTop: 0 }}>
          纯 Markdown。勾选的篇会注入生成/改写/审核，与事实卡冲突时以事实卡为准。
        </p>
        <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          <button className="ghost" type="button" onClick={() => void persistKnowledge([...knowledge, emptyKnowledge()])}>
            新建一篇
          </button>
          <label className="ghost" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", margin: 0 }}>
            导入 .md
            <input
              type="file"
              accept=".md,text/markdown,text/plain"
              multiple
              hidden
              onChange={(e) => {
                importMarkdownFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="ghost"
            type="button"
            disabled={knowledge.length === 0}
            onClick={() => void persistKnowledge(knowledge.map((d) => ({ ...d, selected: true })))}
          >
            全选
          </button>
          <button
            className="ghost"
            type="button"
            disabled={knowledge.length === 0}
            onClick={() => void persistKnowledge(knowledge.map((d) => ({ ...d, selected: false })))}
          >
            反全选
          </button>
        </div>
        <p className="count">
          已选 {knowledge.filter((d) => d.selected).length} / {knowledge.length}
        </p>
        {knowledge.map((d) => (
          <div key={d.id} className={`kb-card${d.selected ? " picked" : ""}`}>
            <div className="kb-head">
              <input
                type="checkbox"
                checked={d.selected}
                title="参与本次生成"
                onChange={(e) => patchKnowledge(d.id, { selected: e.target.checked })}
              />
              <input
                placeholder="篇名，如产品手册"
                value={d.title}
                onChange={(e) => patchKnowledge(d.id, { title: e.target.value })}
              />
              <button className="ghost" type="button" onClick={() => void persistKnowledge(knowledge.filter((x) => x.id !== d.id))}>
                删
              </button>
            </div>
            <textarea
              rows={10}
              spellCheck={false}
              placeholder={"# 标题\n\n用 Markdown 写资料、FAQ、流程。生成时只参考勾选篇。"}
              value={d.markdown}
              onChange={(e) => patchKnowledge(d.id, { markdown: e.target.value })}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
