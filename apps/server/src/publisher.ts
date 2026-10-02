import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createId, isSaveDraftEditorPlatform, nowIso, type Asset, type PlatformDraft, type PlatformId, type PublishJob, type PublishTarget, type TopicSession } from "@geopost/shared";
import { getRule, orderedPlatforms } from "@geopost/rules";
import { planPartialFill, validateSession } from "./compliance.js";
import { logger } from "./logger.js";
import { markdownToHtml } from "./markdown.js";
import { openEditor, runPublish } from "./bridge.js";
import { getSettings, paths, saveEditorCatalog, saveJob } from "./store.js";

type PackedImage = PublishTarget["coverImages"][number];

function packAsset(asset: Asset): PackedImage {
  const buf = readFileSync(join(paths.dataDir, asset.relPath));
  logger.info("publish.pack_asset", {
    filename: asset.filename,
    mimeType: asset.mimeType,
    bytes: buf.length,
  });
  return {
    filename: asset.filename,
    mimeType: asset.mimeType,
    base64: buf.toString("base64"),
  };
}

/** 把素材库引用换成 data URL，官方页才能看见图而不是裂开的 assetId。 */
function embedMarkdownImages(markdown: string, session: TopicSession): { markdown: string; bodyImages: PackedImage[] } {
  const bodyImages: PackedImage[] = [];
  let next = markdown;
  for (const asset of session.assets) {
    const packed = packAsset(asset);
    const dataUrl = `data:${asset.mimeType};base64,${packed.base64}`;
    const needles = [
      `(${asset.id})`,
      `(/api/assets/${asset.filename})`,
      `(http://127.0.0.1:5173/api/assets/${asset.filename})`,
      `(http://localhost:5173/api/assets/${asset.filename})`,
      `(http://127.0.0.1:8787/api/assets/${asset.filename})`,
    ];
    const before = next;
    for (const needle of needles) next = next.split(needle).join(`(${dataUrl})`);
    if (next !== before) bodyImages.push(packed);
  }
  return { markdown: next, bodyImages };
}

function toTarget(session: TopicSession, draft: PlatformDraft): PublishTarget {
  const covers = draft.coverAssetIds
    .map((id) => session.assets.find((a) => a.id === id))
    .filter((a): a is Asset => Boolean(a))
    .map(packAsset);

  const embedded = embedMarkdownImages(draft.markdown, session);
  logger.info("publish.embed_images", {
    platform: draft.platform,
    covers: covers.length,
    bodyImages: embedded.bodyImages.length,
    location: draft.location || undefined,
  });

  return {
    platform: draft.platform,
    mode: draft.mode,
    title: draft.title,
    markdown: draft.markdown,
    summary: draft.summary,
    html: markdownToHtml(embedded.markdown),
    coverImages: covers,
    bodyImages: embedded.bodyImages,
    category: draft.category,
    tags: draft.tags,
    location: draft.location ?? "",
    extras: (() => {
      const extras = { ...(draft.extras ?? {}) };
      if (draft.location?.trim()) {
        const key = Object.keys(extras).find((k) => /位置/.test(k)) ?? "添加位置";
        if (!extras[key]) extras[key] = draft.location.trim();
      }
      return extras;
    })(),
    aiDeclared: draft.aiDeclared,
    claimOriginal: draft.claimOriginal,
    claimFirstPublish: draft.claimFirstPublish,
    claimExclusive: draft.claimExclusive,
  };
}

/** 按 GEO 顺序展开已勾选平台；图片在这里读盘转 base64，Cookie 仍不出现。 */
export function buildTargets(session: TopicSession): PublishTarget[] {
  const order = orderedPlatforms();
  return order
    .map((id) => session.platforms[id])
    .filter((d) => d?.selected)
    .map((d) => toTarget(session, d));
}

/** 按 GEO 顺序打开官方编辑器并填表；不点发布。Cookie 不出浏览器。 */
export async function executeJob(session: TopicSession, onlyPlatforms?: PlatformId[]): Promise<PublishJob> {
  const plan = planPartialFill(session);
  const ids = onlyPlatforms?.length ? onlyPlatforms : plan.fillable;
  if (ids.length === 0) {
    logger.warn("publish.blocked", { errors: plan.issues.errors, skipped: plan.skipped.length });
    throw Object.assign(new Error("没有可填入的平台。缺封面等站会留在详情页，请补齐后再单独填入。"), {
      issues: plan.issues,
    });
  }
  // 只校验拟填入子集，缺封面的站不挡其他家。
  const subset = validateSession({
    ...session,
    platforms: Object.fromEntries(
      Object.entries(session.platforms).map(([id, d]) => [id, { ...d, selected: ids.includes(id as PlatformId) }]),
    ) as TopicSession["platforms"],
  });
  if (!subset.ok) {
    logger.warn("publish.subset_blocked", { errors: subset.errors, ids });
    throw Object.assign(new Error("拟填入平台校验未通过"), { issues: subset });
  }

  const allow = new Set(ids);
  const targets = buildTargets(session).filter((t) => allow.has(t.platform));
  const job: PublishJob = {
    id: createId("job"),
    sessionId: session.id,
    targets,
    results: [],
    status: "running",
    createdAt: nowIso(),
  };
  saveJob(job);
  logger.info("publish.job_start", { jobId: job.id, platforms: targets.map((t) => t.platform) });

  for (const target of targets) {
    const rule = getRule(target.platform);
    if (rule.kind === "checklist") {
      const settings = getSettings();
      const url =
        target.platform === "website"
          ? settings.websiteUrl || undefined
          : settings.baikeUrl || rule.editorUrl;
      await openEditor(target.platform, url);
      job.results.push({
        platform: target.platform,
        ok: true,
        message: "已打开维护页，请按清单人工核对（不自动提交）",
        editorOpened: true,
      });
      saveJob(job);
      continue;
    }
    const saveDraftThenEdit = isSaveDraftEditorPlatform(target.platform);
    // 填表站与存稿站都走 saveDraft：扩展只填表/存草稿，不点官方发布。
    logger.info("publish.platform_start", {
      platform: target.platform,
      saveDraftThenEdit,
      bridgeMode: "saveDraft",
    });
    try {
      const result = await runPublish("saveDraft", target);
      if (result.catalog) saveEditorCatalog(result.catalog);
      job.results.push(result);
      logger.info("publish.platform_done", {
        platform: result.platform,
        ok: result.ok,
        detail: result.message,
        extraFields: (result.catalog?.extraFields ?? []).map((f) => f.label),
      });
      // 填表失败时官方编辑器已经开着，不要再多开一页。
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("publish.platform_fail", { platform: target.platform, message });
      await openEditor(target.platform).catch(() => undefined);
      job.results.push({
        platform: target.platform,
        ok: false,
        message,
        editorOpened: true,
      });
    }
    saveJob(job);
  }

  job.status = "done";
  saveJob(job);
  logger.info("publish.job_done", { jobId: job.id, ok: job.results.filter((r) => r.ok).length });
  return job;
}
