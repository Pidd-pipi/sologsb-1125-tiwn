import type { AnalysisRecord } from '../types/analysis';
import { ANALYSIS_METHOD_LABELS } from '../types/analysis';
import type { FindRecord } from '../types/find';
import {
  COORDINATE_SOURCE_LABELS,
  FIND_ENVIRONMENT_LABELS,
} from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import {
  CHEMICAL_GROUP_LABELS,
  FALL_OR_FIND_LABELS,
  STORAGE_LABELS,
  WEATHERING_LABELS,
} from '../types/sample';
import type { ThinSection } from '../types/section';
import { PREPARATION_LABELS, SECTION_QUALITY_LABELS } from '../types/section';

/** 初版修订号：v4 升级时为全部旧记录回填 */
export const INITIAL_REVISION = 1;

/** 一份样本档案簇：样本本身 + 关联的发现记录、切片与检测记录 */
export interface SampleBundle {
  sample: MeteoriteSample;
  find?: FindRecord;
  sections: ThinSection[];
  analysis: AnalysisRecord[];
}

/** 参与冲突检查的实体类型 */
export type EntityKind = 'sample' | 'find' | 'section' | 'analysis';

/** 各实体当前修订号：样本为号，关联记录按 id 记录 */
export interface BundleRevisions {
  sample: number;
  find?: { id: string; revision: number };
  sections: { id: string; revision: number }[];
  analysis: { id: string; revision: number }[];
}

/** 字段冲突：双方都改了同一字段且取值不同，需要人工裁定 */
export interface FieldConflict {
  entity: EntityKind;
  entityId: string;
  entityLabel: string;
  field: string;
  label: string;
  base: string;
  mine: string;
  theirs: string;
}

/** 自动合并字段：对方改动、本侧未动，已静默采用新版本值 */
export interface MergedField {
  entity: EntityKind;
  entityId: string;
  entityLabel: string;
  field: string;
  label: string;
  theirs: string;
}

/** 一次提交的裁定结果 */
export type FieldResolution = 'mine' | 'theirs';
export type ResolutionMap = Record<string, FieldResolution>;

export const conflictKey = (c: { entity: EntityKind; entityId: string; field: string }): string =>
  `${c.entity}:${c.entityId}:${c.field}`;

export function bundleRevisions(b: SampleBundle): BundleRevisions {
  return {
    sample: b.sample.revision,
    find: b.find ? { id: b.find.id, revision: b.find.revision } : undefined,
    sections: b.sections.map((s) => ({ id: s.id, revision: s.revision })),
    analysis: b.analysis.map((a) => ({ id: a.id, revision: a.revision })),
  };
}

/** 详情、分布与总览共用的版本签名：簇内任一记录修订号变化都会变化 */
export function bundleSignature(b: SampleBundle): string {
  const parts = [
    `s:${b.sample.revision}`,
    b.find ? `f:${b.find.id}@${b.find.revision}` : 'f:∅',
    ...b.sections.map((s) => `q:${s.id}@${s.revision}`),
    ...b.analysis.map((a) => `a:${a.id}@${a.revision}`),
  ];
  return parts.join('|');
}

/** 读取详情时持有的修订号是否已落后于库内当前版本 */
export function isStale(base: BundleRevisions, current: BundleRevisions): boolean {
  if (base.sample !== current.sample) return true;
  if ((base.find?.revision ?? 0) !== (current.find?.revision ?? 0)) return true;
  const mapIds = (list: { id: string; revision: number }[]) =>
    new Map(list.map((x) => [x.id, x.revision]));
  const bs = mapIds(base.sections);
  const cs = mapIds(current.sections);
  if (bs.size !== cs.size) return true;
  for (const [id, rev] of cs) if (bs.get(id) !== rev) return true;
  const ba = mapIds(base.analysis);
  const ca = mapIds(current.analysis);
  if (ba.size !== ca.size) return true;
  for (const [id, rev] of ca) if (ba.get(id) !== rev) return true;
  return false;
}

/** 实体字段中文标签（冲突清单与裁定对话框共用） */
const FIELD_LABELS: Record<EntityKind, Record<string, string>> = {
  sample: {
    category: '分类',
    chemicalGroup: '化学群',
    weathering: '风化等级',
    fallOrFind: '发现 / 坠落',
    storage: '存放位置',
    totalWeight: '总重量',
    note: '备注',
  },
  find: {
    placeName: '发现地名',
    region: '国家 / 地区',
    longitude: '经度',
    latitude: '纬度',
    coordinateSource: '坐标来源',
    environment: '发现环境',
    finder: '发现者',
  },
  section: {
    sectionNo: '切片编号',
    thickness: '厚度 μm',
    preparation: '制样方式',
    quality: '质量标注',
    minerals: '矿物占比',
    micrographs: '显微照片',
  },
  analysis: {
    method: '检测方法',
    fa: '橄榄石 Fa',
    fs: '辉石 Fs',
    ni: 'Ni 含量',
    kamaciteBandwidth: '铁纹石带宽',
    testedAt: '检测日期',
  },
};

export function fieldLabel(entity: EntityKind, field: string): string {
  return FIELD_LABELS[entity]?.[field] ?? field;
}

function codeLabel(entity: EntityKind, field: string, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '—';
  switch (entity) {
    case 'sample':
      if (field === 'category') {
        // 分类标签独立维护在 CATEGORY_LABELS，这里避免循环依赖直接给中文映射
        return (
          { chondrite: '球粒陨石', iron: '铁陨石', 'stony-iron': '石铁陨石', achondrite: '无球粒陨石' } as Record<
            string,
            string
          >
        )[String(raw)] ?? String(raw);
      }
      if (field === 'chemicalGroup') return CHEMICAL_GROUP_LABELS[raw as keyof typeof CHEMICAL_GROUP_LABELS] ?? String(raw);
      if (field === 'weathering') return WEATHERING_LABELS[raw as keyof typeof WEATHERING_LABELS] ?? String(raw);
      if (field === 'fallOrFind') return FALL_OR_FIND_LABELS[raw as keyof typeof FALL_OR_FIND_LABELS] ?? String(raw);
      if (field === 'storage') return STORAGE_LABELS[raw as keyof typeof STORAGE_LABELS] ?? String(raw);
      break;
    case 'find':
      if (field === 'coordinateSource')
        return COORDINATE_SOURCE_LABELS[raw as keyof typeof COORDINATE_SOURCE_LABELS] ?? String(raw);
      if (field === 'environment')
        return FIND_ENVIRONMENT_LABELS[raw as keyof typeof FIND_ENVIRONMENT_LABELS] ?? String(raw);
      break;
    case 'section':
      if (field === 'preparation') return PREPARATION_LABELS[raw as keyof typeof PREPARATION_LABELS] ?? String(raw);
      if (field === 'quality') return SECTION_QUALITY_LABELS[raw as keyof typeof SECTION_QUALITY_LABELS] ?? String(raw);
      break;
    case 'analysis':
      if (field === 'method') return ANALYSIS_METHOD_LABELS[raw as keyof typeof ANALYSIS_METHOD_LABELS] ?? String(raw);
      break;
  }
  return String(raw);
}

/** 冲突三态值的可读文本（minerals 等对象做摘要） */
export function displayValue(entity: EntityKind, field: string, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '—';
  if (field === 'minerals' && typeof raw === 'object') {
    const m = raw as Record<string, unknown>;
    return `橄榄石 ${m.olivine}% / 辉石 ${m.pyroxene}% / 长石 ${m.feldspar}% / 金属 ${m.metal}%`;
  }
  if (Array.isArray(raw)) return raw.length ? raw.join('、') : '—';
  if (typeof raw === 'number') {
    return field === 'longitude' || field === 'latitude' ? raw.toFixed(4) : String(raw);
  }
  return codeLabel(entity, field, raw);
}

/** 参与三方比对的可变字段（不含 id / sampleId / createdAt / revision 等元数据） */
export const EDITABLE_FIELDS: Record<EntityKind, string[]> = {
  sample: ['category', 'chemicalGroup', 'weathering', 'fallOrFind', 'storage', 'totalWeight', 'note'],
  find: ['placeName', 'region', 'longitude', 'latitude', 'coordinateSource', 'environment', 'finder'],
  section: ['sectionNo', 'thickness', 'preparation', 'quality', 'minerals', 'micrographs'],
  analysis: ['method', 'fa', 'fs', 'ni', 'kamaciteBandwidth', 'testedAt'],
};

function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b) ? false : a === b;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function entityLabel(kind: EntityKind, e: unknown): string {
  const r = e as { sampleNo?: string; placeName?: string; sectionNo?: string; testedAt?: string };
  if (kind === 'sample') return `样本 ${r.sampleNo ?? ''}`.trim();
  if (kind === 'find') return `发现记录 ${r.placeName ?? ''}`.trim();
  if (kind === 'section') return `切片 ${r.sectionNo ?? ''}`.trim();
  return `检测记录 ${r.testedAt ?? ''}`.trim();
}

interface DiffInput {
  entity: EntityKind;
  entityId: string;
  entityLabel: string;
  fields: string[];
  base: Record<string, unknown>;
  mine: Record<string, unknown>;
  current: Record<string, unknown>;
}

/**
 * 三方合并：
 *  - 本侧与对方都改了同一字段且值不同 → 字段冲突（待人工裁定，默认保留本次输入）
 *  - 仅对方改动 → 自动合并
 * 返回需要落库的补丁（mine 优先于自动合并）与冲突/合并清单。
 */
export function threeWayDiff(input: DiffInput): {
  conflicts: FieldConflict[];
  merged: MergedField[];
} {
  const conflicts: FieldConflict[] = [];
  const merged: MergedField[] = [];
  for (const field of input.fields) {
    const b = input.base[field];
    const m = input.mine[field];
    const t = input.current[field];
    // 补丁里没带的字段视为本侧未改动（保持 base 值）
    const mineChanged = field in input.mine ? !isSameValue(b, m) : false;
    const theirsChanged = !isSameValue(b, t);
    if (mineChanged && theirsChanged && !isSameValue(m, t)) {
      conflicts.push({
        entity: input.entity,
        entityId: input.entityId,
        entityLabel: input.entityLabel,
        field,
        label: fieldLabel(input.entity, field),
        base: displayValue(input.entity, field, b),
        mine: displayValue(input.entity, field, m),
        theirs: displayValue(input.entity, field, t),
      });
    } else if (!mineChanged && theirsChanged) {
      merged.push({
        entity: input.entity,
        entityId: input.entityId,
        entityLabel: input.entityLabel,
        field,
        label: fieldLabel(input.entity, field),
        theirs: displayValue(input.entity, field, t),
      });
    }
  }
  return { conflicts, merged };
}

export interface MergeEntitiesInput {
  base: SampleBundle;
  current: SampleBundle;
  mine: {
    sample: Partial<MeteoriteSample>;
    find?: Partial<FindRecord>;
    sections: { id: string; patch: Partial<ThinSection> }[];
    analysis: { id: string; patch: Partial<AnalysisRecord> }[];
  };
}

/** 对整份档案簇做三方比对（簇内新增的记录不产生冲突） */
export function mergeBundle(input: MergeEntitiesInput): {
  conflicts: FieldConflict[];
  merged: MergedField[];
} {
  const out: { conflicts: FieldConflict[]; merged: MergedField[] } = { conflicts: [], merged: [] };
  const push = (r: { conflicts: FieldConflict[]; merged: MergedField[] }) => {
    out.conflicts.push(...r.conflicts);
    out.merged.push(...r.merged);
  };

  push(
    threeWayDiff({
      entity: 'sample',
      entityId: input.base.sample.id,
      entityLabel: entityLabel('sample', input.base.sample),
      fields: EDITABLE_FIELDS.sample,
      base: input.base.sample as unknown as Record<string, unknown>,
      mine: input.mine.sample as Record<string, unknown>,
      current: input.current.sample as unknown as Record<string, unknown>,
    }),
  );

  if (input.mine.find && input.base.find && input.current.find) {
    push(
      threeWayDiff({
        entity: 'find',
        entityId: input.base.find.id,
        entityLabel: entityLabel('find', input.base.find),
        fields: EDITABLE_FIELDS.find,
        base: input.base.find as unknown as Record<string, unknown>,
        mine: input.mine.find as Record<string, unknown>,
        current: input.current.find as unknown as Record<string, unknown>,
      }),
    );
  }

  for (const item of input.mine.sections) {
    const b = input.base.sections.find((s) => s.id === item.id);
    const c = input.current.sections.find((s) => s.id === item.id);
    if (!b || !c) continue; // 本侧/对方新增的切片不比对
    push(
      threeWayDiff({
        entity: 'section',
        entityId: b.id,
        entityLabel: entityLabel('section', b),
        fields: EDITABLE_FIELDS.section.filter((f) => f in item.patch),
        base: b as unknown as Record<string, unknown>,
        mine: item.patch as Record<string, unknown>,
        current: c as unknown as Record<string, unknown>,
      }),
    );
  }

  for (const item of input.mine.analysis) {
    const b = input.base.analysis.find((a) => a.id === item.id);
    const c = input.current.analysis.find((a) => a.id === item.id);
    if (!b || !c) continue;
    push(
      threeWayDiff({
        entity: 'analysis',
        entityId: b.id,
        entityLabel: entityLabel('analysis', b),
        fields: EDITABLE_FIELDS.analysis.filter((f) => f in item.patch),
        base: b as unknown as Record<string, unknown>,
        mine: item.patch as Record<string, unknown>,
        current: c as unknown as Record<string, unknown>,
      }),
    );
  }

  return out;
}

/**
 * 依据裁定结果修正本次补丁：
 *  - mine（默认）：保留本次输入
 *  - theirs：改用库内新版本值（等于该字段不写入）
 *  - 自动合并字段：一律采用库内值（从补丁中移除本侧旧值）
 */
export function applyResolutions<T extends object>(
  patch: T,
  opts: {
    entity: EntityKind;
    entityId: string;
    conflicts: FieldConflict[];
    merged: MergedField[];
    resolutions: ResolutionMap;
  },
): Partial<T> {
  const result: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  for (const c of opts.conflicts) {
    if (c.entity !== opts.entity || c.entityId !== opts.entityId) continue;
    if (opts.resolutions[conflictKey(c)] === 'theirs') delete result[c.field];
  }
  for (const m of opts.merged) {
    if (m.entity !== opts.entity || m.entityId !== opts.entityId) continue;
    delete result[m.field]; // 本侧未改，采用对方值
  }
  return result as Partial<T>;
}
