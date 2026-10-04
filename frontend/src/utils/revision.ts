import type { MeteoriteSample } from '../types/sample';
import type { FindRecord } from '../types/find';
import type { ThinSection } from '../types/section';
import type { AnalysisRecord } from '../types/analysis';

/** 聚合状态：详情页一次检查的四类记录 */
export interface AggregateState {
  sample: MeteoriteSample;
  find: FindRecord | undefined;
  sections: ThinSection[];
  analysis: AnalysisRecord[];
}

/** 聚合快照：各记录的修订号，用于详情页判断是否落后 */
export interface AggregateSnapshot {
  sampleRevision: number;
  findRevision: number | null;
  sectionRevisions: Record<string, number>;
  analysisRevisions: Record<string, number>;
}

/** 字段冲突：用户输入与当前档案值不一致的字段 */
export interface FieldConflict {
  field: string;
  label: string;
  yours: unknown;
  current: unknown;
}

/** 样本可编辑字段的中文标签（用于冲突列表） */
export const SAMPLE_FIELD_LABELS: Record<string, string> = {
  sampleNo: '样本编号',
  totalWeight: '总重量',
  category: '分类',
  chemicalGroup: '化学群',
  weathering: '风化等级',
  fallOrFind: '发现 / 坠落',
  storage: '存放位置',
  note: '备注',
};

/** 发现记录可编辑字段的中文标签 */
export const FIND_FIELD_LABELS: Record<string, string> = {
  placeName: '发现地名',
  region: '国家 / 地区',
  longitude: '经度',
  latitude: '纬度',
  coordinateSource: '坐标来源',
  environment: '发现环境',
  finder: '发现者',
};

/** 从聚合状态提取修订号快照 */
export function snapshotOf(agg: AggregateState): AggregateSnapshot {
  return {
    sampleRevision: num(agg.sample.revision),
    findRevision: agg.find ? num(agg.find.revision) : null,
    sectionRevisions: Object.fromEntries(agg.sections.map((s) => [s.id, num(s.revision)])),
    analysisRevisions: Object.fromEntries(agg.analysis.map((a) => [a.id, num(a.revision)])),
  };
}

/** 判断样本修订号是否落后于基线 */
export function sampleRevisionStale(current: number, base: number): boolean {
  return num(current) > num(base);
}

/**
 * 检查聚合快照是否有任意记录落后。
 * 返回 stale 与变化的记录键（sample / find / section:<id> / analysis:<id>）。
 */
export function aggregateStale(
  current: AggregateSnapshot,
  base: AggregateSnapshot,
): { stale: boolean; changedKeys: string[] } {
  const changedKeys: string[] = [];
  if (sampleRevisionStale(current.sampleRevision, base.sampleRevision)) changedKeys.push('sample');
  if (current.findRevision !== base.findRevision) changedKeys.push('find');

  const sectionIds = new Set([
    ...Object.keys(base.sectionRevisions),
    ...Object.keys(current.sectionRevisions),
  ]);
  for (const id of sectionIds) {
    if (num(current.sectionRevisions[id]) !== num(base.sectionRevisions[id])) {
      changedKeys.push(`section:${id}`);
    }
  }

  const analysisIds = new Set([
    ...Object.keys(base.analysisRevisions),
    ...Object.keys(current.analysisRevisions),
  ]);
  for (const id of analysisIds) {
    if (num(current.analysisRevisions[id]) !== num(base.analysisRevisions[id])) {
      changedKeys.push(`analysis:${id}`);
    }
  }

  return { stale: changedKeys.length > 0, changedKeys };
}

/** 计算样本字段级冲突：patch 中与当前档案值不一致的字段 */
export function sampleFieldConflicts(
  patch: Partial<MeteoriteSample>,
  current: MeteoriteSample,
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  for (const [field, yours] of Object.entries(patch)) {
    if (field === 'id' || field === 'createdAt' || field === 'updatedAt' || field === 'revision') {
      continue;
    }
    const cur = (current as unknown as Record<string, unknown>)[field];
    if (!deepEqual(yours, cur)) {
      conflicts.push({ field, label: SAMPLE_FIELD_LABELS[field] ?? field, yours, current: cur });
    }
  }
  return conflicts;
}

/** 计算发现记录字段级冲突 */
export function findFieldConflicts(
  patch: Partial<FindRecord>,
  current: FindRecord,
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  for (const [field, yours] of Object.entries(patch)) {
    if (field === 'id' || field === 'sampleId' || field === 'createdAt' || field === 'revision') {
      continue;
    }
    const cur = (current as unknown as Record<string, unknown>)[field];
    if (!deepEqual(yours, cur)) {
      conflicts.push({ field, label: FIND_FIELD_LABELS[field] ?? field, yours, current: cur });
    }
  }
  return conflicts;
}

/** 修订号自增 1 */
export function nextRevision(r: number): number {
  return num(r) + 1;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
