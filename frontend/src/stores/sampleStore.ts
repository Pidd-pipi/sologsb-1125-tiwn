import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import {
  INITIAL_REVISION,
  applyResolutions,
  bundleRevisions,
  conflictKey,
  isStale,
  mergeBundle,
  type BundleRevisions,
  type FieldConflict,
  type MergedField,
  type ResolutionMap,
  type SampleBundle,
} from '../utils/revision';

/** 一次档案簇修订中允许的编辑：find/sections/analysis 条目带 id 为更新，不带为新增 */
export interface BundleEdits {
  sample?: Partial<MeteoriteSample>;
  find?: { id?: string } & Partial<FindRecord>;
  sections?: Array<{ id?: string } & Partial<ThinSection>>;
  analysis?: Array<{ id?: string } & Partial<AnalysisRecord>>;
}

export interface SaveBundleRequest {
  sampleId: string;
  /** 开始编辑时的档案簇快照（三方合并的 base） */
  base: SampleBundle;
  edits: BundleEdits;
  /** 冲突对话框针对的当前版本（第二次提交裁定时带上） */
  expected?: BundleRevisions;
  /** 字段裁定：mine 保留本次输入（默认），theirs 采用对方新版本 */
  resolutions?: ResolutionMap;
}

export type SaveBundleResult =
  | { ok: true; revision: number }
  | {
      ok: false;
      reason: 'stale';
      conflicts: FieldConflict[];
      merged: MergedField[];
      current: SampleBundle;
      currentRevisions: BundleRevisions;
    }
  | { ok: false; reason: 'missing' };

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt' | 'revision'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  /** 按修订号检查整份档案簇，版本落后时返回字段冲突；裁定完成后才写入新版本 */
  saveBundleRevision: (req: SaveBundleRequest) => Promise<SaveBundleResult>;
  nextSampleSeq: () => number;
}

/** 跨标签页联动通道：两个窗口同时编辑同一本地库时互相通知重算 */
const syncChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gbmeteorite-revision') : null;

function notifyChanged(sampleId?: string) {
  try {
    syncChannel?.postMessage({ type: 'changed', sampleId, at: Date.now() });
  } catch {
    /* 通道不可用时静默退化为本标签页使用 */
  }
}

/** 从库内重读一份档案簇（详情/分布/总览共用的同一版本聚合） */
async function readBundle(tx: {
  samples: typeof db.samples;
  finds: typeof db.finds;
  sections: typeof db.sections;
  analysis: typeof db.analysis;
}, sampleId: string): Promise<SampleBundle | undefined> {
  const sample = await tx.samples.get(sampleId);
  if (!sample) return undefined;
  const [finds, sections, analysis] = await Promise.all([
    tx.finds.where('sampleId').equals(sampleId).toArray(),
    tx.sections.where('sampleId').equals(sampleId).toArray(),
    tx.analysis.where('sampleId').equals(sampleId).toArray(),
  ]);
  const byCreated = <T extends { createdAt: number }>(a: T, b: T) => b.createdAt - a.createdAt;
  return {
    sample,
    find: finds[0],
    sections: sections.sort(byCreated),
    analysis: analysis.sort(byCreated),
  };
}

/** 防御性兜底：未带修订号的记录（理论上 v4 已回填）一律视为初版 */
function withRevision<T extends { revision?: number }>(rec: T): T & { revision: number } {
  return { ...rec, revision: typeof rec.revision === 'number' ? rec.revision : INITIAL_REVISION };
}

/** 样本修订号 +1 并刷新 updatedAt（关联记录的任何写入都推动档案簇到新版本） */
async function bumpSampleRevision(sampleId: string) {
  const sample = await db.samples.get(sampleId);
  if (sample) {
    await db.samples.put({ ...sample, revision: sample.revision + 1, updatedAt: Date.now() });
  }
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    const [rawSamples, rawFinds, rawSections, rawAnalysis] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
    ]);
    const samples = rawSamples.map(withRevision);
    const finds = rawFinds.map(withRevision);
    const sections = rawSections.map(withRevision);
    const analysis = rawAnalysis.map(withRevision);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    set({ samples, finds, sections, analysis, loading: false, loaded: true });
  },

  addSample: async (input) => {
    const now = Date.now();
    const record: MeteoriteSample = {
      ...input,
      id: makeId('sample'),
      createdAt: now,
      updatedAt: now,
      revision: INITIAL_REVISION,
    };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    notifyChanged(record.id);
    return record.id;
  },

  updateSample: async (id, patch) => {
    const updatedAt = Date.now();
    await db.transaction('rw', db.samples, async () => {
      const current = await db.samples.get(id);
      if (!current) return;
      await db.samples.put({
        ...current,
        ...patch,
        updatedAt,
        revision: current.revision + 1,
      });
    });
    set({
      samples: get().samples.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt, revision: s.revision + 1 } : s,
      ),
    });
    notifyChanged(id);
  },

  removeSample: async (id) => {
    await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async () => {
      await db.samples.delete(id);
      await db.finds.where('sampleId').equals(id).delete();
      await db.sections.where('sampleId').equals(id).delete();
      await db.analysis.where('sampleId').equals(id).delete();
    });
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
    });
    notifyChanged(id);
  },

  addFind: async (input) => {
    const record: FindRecord = {
      ...input,
      id: makeId('find'),
      createdAt: Date.now(),
      revision: INITIAL_REVISION,
    };
    await db.transaction('rw', db.finds, db.samples, async () => {
      await db.finds.add(record);
      await bumpSampleRevision(input.sampleId);
    });
    await get().loadAll();
    notifyChanged(input.sampleId);
    return record.id;
  },

  addSection: async (input) => {
    const record: ThinSection = {
      ...input,
      id: makeId('section'),
      createdAt: Date.now(),
      revision: INITIAL_REVISION,
    };
    await db.transaction('rw', db.sections, db.samples, async () => {
      await db.sections.add(record);
      await bumpSampleRevision(input.sampleId);
    });
    await get().loadAll();
    notifyChanged(input.sampleId);
    return record.id;
  },

  updateSection: async (id, patch) => {
    await db.transaction('rw', db.sections, db.samples, async () => {
      const current = await db.sections.get(id);
      if (!current) return;
      await db.sections.put({ ...current, ...patch, revision: current.revision + 1 });
      await bumpSampleRevision(current.sampleId);
    });
    await get().loadAll();
    notifyChanged();
  },

  addAnalysis: async (input) => {
    const record: AnalysisRecord = {
      ...input,
      id: makeId('analysis'),
      createdAt: Date.now(),
      revision: INITIAL_REVISION,
    };
    await db.transaction('rw', db.analysis, db.samples, async () => {
      await db.analysis.add(record);
      await bumpSampleRevision(input.sampleId);
    });
    await get().loadAll();
    notifyChanged(input.sampleId);
    return record.id;
  },

  saveBundleRevision: async (req) => {
    const tables = {
      samples: db.samples,
      finds: db.finds,
      sections: db.sections,
      analysis: db.analysis,
    };
    return db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async (): Promise<SaveBundleResult> => {
      const current = await readBundle(tables, req.sampleId);
      if (!current) return { ok: false, reason: 'missing' };

      const baseRev = bundleRevisions(req.base);
      const currentRev = bundleRevisions(current);
      const stale = isStale(baseRev, currentRev);

      // 双方同时补发现地（base 无记录、current 已有记录）：以仅带 id 的空记录为 base 做三方比对
      const bothAddedFind =
        stale && !!req.edits.find && !req.edits.find.id && !req.base.find && !!current.find;
      const diffBase: SampleBundle = bothAddedFind
        ? { ...req.base, find: { id: current.find!.id } as FindRecord }
        : req.base;

      const mine = {
        sample: req.edits.sample ?? {},
        find: req.edits.find,
        sections: (req.edits.sections ?? [])
          .filter((e) => e.id)
          .map((e) => ({ id: e.id as string, patch: e })),
        analysis: (req.edits.analysis ?? [])
          .filter((e) => e.id)
          .map((e) => ({ id: e.id as string, patch: e })),
      };
      const diff = stale ? mergeBundle({ base: diffBase, current, mine }) : { conflicts: [], merged: [] };

      if (stale && !req.resolutions) {
        return {
          ok: false,
          reason: 'stale',
          conflicts: diff.conflicts,
          merged: diff.merged,
          current,
          currentRevisions: currentRev,
        };
      }
      // 对话框打开期间版本又前进，且出现尚未裁定的新冲突：返回最新冲突清单
      if (stale && req.expected && JSON.stringify(req.expected) !== JSON.stringify(currentRev)) {
        const hasUnresolved = diff.conflicts.some(
          (c) => req.resolutions?.[conflictKey(c)] === undefined,
        );
        if (hasUnresolved) {
          return {
            ok: false,
            reason: 'stale',
            conflicts: diff.conflicts,
            merged: diff.merged,
            current,
            currentRevisions: currentRev,
          };
        }
      }

      const now = Date.now();
      const resolutions = req.resolutions ?? {};

      // —— 样本本身 ——
      let samplePatch: Partial<MeteoriteSample> = { ...(req.edits.sample ?? {}) };
      if (stale) {
        samplePatch = applyResolutions(samplePatch, {
          entity: 'sample',
          entityId: current.sample.id,
          conflicts: diff.conflicts,
          merged: diff.merged,
          resolutions,
        });
      }
      const nextSample: MeteoriteSample = {
        ...current.sample,
        ...samplePatch,
        updatedAt: now,
        revision: current.sample.revision + 1,
      };
      await db.samples.put(nextSample);

      // —— 发现记录（更新或新增；双方同时新增时并入对方那条） ——
      if (req.edits.find) {
        const edit = req.edits.find;
        const targetId = edit.id ?? current.find?.id;
        if (targetId) {
          const existing = await db.finds.get(targetId);
          if (existing) {
            const { id: _omit, ...patchRaw } = edit;
            void _omit;
            let findPatch: Partial<FindRecord> = patchRaw;
            if (stale) {
              findPatch = applyResolutions(findPatch, {
                entity: 'find',
                entityId: targetId,
                conflicts: diff.conflicts,
                merged: diff.merged,
                resolutions,
              });
            }
            await db.finds.put({ ...existing, ...findPatch, revision: existing.revision + 1 });
          }
        } else {
          const { id: _omit, ...fields } = edit;
          void _omit;
          await db.finds.add({
            ...(fields as Omit<FindRecord, 'id' | 'createdAt' | 'revision'>),
            sampleId: req.sampleId,
            id: makeId('find'),
            createdAt: now,
            revision: INITIAL_REVISION,
          });
        }
      }

      // —— 切片（带 id 更新；不带 id 新增） ——
      for (const edit of req.edits.sections ?? []) {
        if (edit.id) {
          const existing = await db.sections.get(edit.id);
          if (!existing) continue;
          const { id: _omit, ...patchRaw } = edit;
          void _omit;
          let patch: Partial<ThinSection> = patchRaw;
          if (stale) {
            patch = applyResolutions(patch, {
              entity: 'section',
              entityId: edit.id,
              conflicts: diff.conflicts,
              merged: diff.merged,
              resolutions,
            });
          }
          await db.sections.put({ ...existing, ...patch, revision: existing.revision + 1 });
        } else {
          const { id: _omit, ...fields } = edit;
          void _omit;
          await db.sections.add({
            ...(fields as Omit<ThinSection, 'id' | 'createdAt' | 'revision'>),
            sampleId: req.sampleId,
            id: makeId('section'),
            createdAt: now,
            revision: INITIAL_REVISION,
          });
        }
      }

      // —— 检测记录（带 id 更新；不带 id 新增） ——
      for (const edit of req.edits.analysis ?? []) {
        if (edit.id) {
          const existing = await db.analysis.get(edit.id);
          if (!existing) continue;
          const { id: _omit, ...patchRaw } = edit;
          void _omit;
          let patch: Partial<AnalysisRecord> = patchRaw;
          if (stale) {
            patch = applyResolutions(patch, {
              entity: 'analysis',
              entityId: edit.id,
              conflicts: diff.conflicts,
              merged: diff.merged,
              resolutions,
            });
          }
          await db.analysis.put({ ...existing, ...patch, revision: existing.revision + 1 });
        } else {
          const { id: _omit, ...fields } = edit;
          void _omit;
          await db.analysis.add({
            ...(fields as Omit<AnalysisRecord, 'id' | 'createdAt' | 'revision'>),
            sampleId: req.sampleId,
            id: makeId('analysis'),
            createdAt: now,
            revision: INITIAL_REVISION,
          });
        }
      }

      await get().loadAll();
      notifyChanged(req.sampleId);
      return { ok: true, revision: nextSample.revision };
    });
  },

  nextSampleSeq: () => {
    const year = new Date().getFullYear();
    const prefix = `MET-${year}-`;
    const used = get()
      .samples.map((s) => s.sampleNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number(no.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const max = used.length ? Math.max(...used) : 0;
    return max + 1;
  },
}));

/** 其他标签页写入后，本标签页重读同一版本数据，保证详情/分布/总览不显示旧汇总 */
syncChannel?.addEventListener('message', (ev: MessageEvent) => {
  if (ev.data?.type === 'changed') {
    void useSampleStore.getState().loadAll();
  }
});

/** 切回本标签页时也兜底重算一次，防止错过通道消息 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && useSampleStore.getState().loaded) {
      void useSampleStore.getState().loadAll();
    }
  });
}
