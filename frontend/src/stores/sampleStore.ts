import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import {
  findFieldConflicts,
  nextRevision,
  sampleFieldConflicts,
  type AggregateState,
  type FieldConflict,
} from '../utils/revision';

/** 提交结果：ok 表示已写入；否则返回字段冲突供裁定 */
export interface CommitResult {
  ok: boolean;
  /** 字段冲突列表（ok=false 时存在） */
  conflicts?: FieldConflict[];
  /** 当前档案值（ok=false 时存在） */
  current?: MeteoriteSample | FindRecord;
  /** 记录已被删除 */
  deleted?: boolean;
}

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  /** 静默重载：不置 loading，用于窗口重新获得焦点时同步跨标签页变更 */
  silentReload: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt' | 'revision'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<void>;
  /** 带修订号检查的样本编辑：版本落后时返回冲突，不写入 */
  commitSampleEdit: (
    sampleId: string,
    baseRevision: number,
    patch: Partial<MeteoriteSample>,
  ) => Promise<CommitResult>;
  /** 带修订号检查的发现记录新增 / 编辑 */
  commitFindEdit: (
    sampleId: string,
    baseRevision: number | null,
    patch: Partial<FindRecord>,
    isNew: boolean,
  ) => Promise<CommitResult>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  /** 从 IndexedDB 重新读取某样本的聚合数据并更新 store，返回最新聚合 */
  reloadAggregate: (sampleId: string) => Promise<AggregateState | null>;
  nextSampleSeq: () => number;
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
    const [samples, finds, sections, analysis] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
    ]);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    set({ samples, finds, sections, analysis, loading: false, loaded: true });
  },

  silentReload: async () => {
    const [samples, finds, sections, analysis] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
    ]);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    set({ samples, finds, sections, analysis });
  },

  addSample: async (input) => {
    const now = Date.now();
    const record: MeteoriteSample = {
      ...input,
      id: makeId('sample'),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    return record.id;
  },

  updateSample: async (id, patch) => {
    const current = await db.samples.get(id);
    if (!current) return;
    const updatedAt = Date.now();
    const updated = { ...patch, updatedAt, revision: nextRevision(current.revision) };
    await db.samples.update(id, updated);
    set({
      samples: get().samples.map((s) => (s.id === id ? { ...s, ...updated } : s)),
    });
  },

  commitSampleEdit: async (sampleId, baseRevision, patch) => {
    const current = await db.samples.get(sampleId);
    if (!current) return { ok: false, deleted: true };
    if (current.revision !== baseRevision) {
      const conflicts = sampleFieldConflicts(patch, current);
      return { ok: false, conflicts, current };
    }
    const now = Date.now();
    const updated = { ...patch, updatedAt: now, revision: nextRevision(current.revision) };
    await db.samples.update(sampleId, updated);
    set({ samples: get().samples.map((s) => (s.id === sampleId ? { ...s, ...updated } : s)) });
    return { ok: true };
  },

  commitFindEdit: async (sampleId, baseRevision, patch, isNew) => {
    if (isNew) {
      const existing = await db.finds.where('sampleId').equals(sampleId).first();
      if (existing) {
        const conflicts = findFieldConflicts(patch, existing);
        return { ok: false, conflicts, current: existing };
      }
      const record: FindRecord = {
        ...patch,
        id: makeId('find'),
        sampleId,
        createdAt: Date.now(),
        revision: 1,
      } as FindRecord;
      await db.finds.add(record);
      set({ finds: [record, ...get().finds] });
      return { ok: true };
    }
    const current = await db.finds.where('sampleId').equals(sampleId).first();
    if (!current) return { ok: false, deleted: true };
    if (current.revision !== baseRevision) {
      const conflicts = findFieldConflicts(patch, current);
      return { ok: false, conflicts, current };
    }
    const updated = { ...patch, revision: nextRevision(current.revision) };
    await db.finds.update(current.id, updated);
    set({ finds: get().finds.map((f) => (f.id === current.id ? { ...f, ...updated } : f)) });
    return { ok: true };
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
  },

  addFind: async (input) => {
    const record: FindRecord = { ...input, id: makeId('find'), createdAt: Date.now(), revision: 1 };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  addSection: async (input) => {
    const record: ThinSection = {
      ...input,
      id: makeId('section'),
      createdAt: Date.now(),
      revision: 1,
    };
    await db.sections.add(record);
    set({ sections: [record, ...get().sections] });
    return record.id;
  },

  updateSection: async (id, patch) => {
    const section = get().sections.find((s) => s.id === id);
    if (!section) return;
    const updated = { ...patch, revision: nextRevision(section.revision) };
    await db.sections.update(id, updated);
    set({ sections: get().sections.map((s) => (s.id === id ? { ...s, ...updated } : s)) });
  },

  addAnalysis: async (input) => {
    const record: AnalysisRecord = {
      ...input,
      id: makeId('analysis'),
      createdAt: Date.now(),
      revision: 1,
    };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    return record.id;
  },

  reloadAggregate: async (sampleId) => {
    const [sample, finds, sections, analysis] = await Promise.all([
      db.samples.get(sampleId),
      db.finds.where('sampleId').equals(sampleId).toArray(),
      db.sections.where('sampleId').equals(sampleId).toArray(),
      db.analysis.where('sampleId').equals(sampleId).toArray(),
    ]);
    if (!sample) return null;
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    set({
      samples: get().samples.map((s) => (s.id === sampleId ? sample : s)),
      finds: [...get().finds.filter((f) => f.sampleId !== sampleId), ...finds],
      sections: [...get().sections.filter((s) => s.sampleId !== sampleId), ...sections],
      analysis: [...get().analysis.filter((a) => a.sampleId !== sampleId), ...analysis],
    });
    return { sample, find: finds[0], sections, analysis };
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
