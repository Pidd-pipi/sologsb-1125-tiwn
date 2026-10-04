import { useMemo } from 'react';
import type { MeteoriteSample } from '../types/sample';
import { useSampleBundles } from './useSampleBundles';
import { useSampleStore } from '../stores/sampleStore';
import { useUiStore } from '../stores/uiStore';

/**
 * 管理分类、化学群、重量区间与关键词筛选并返回结果集。
 * 被 / 与 /sections 消费；样本列表取自版本化档案簇聚合，与详情、分布读同一版本。
 */
export function useSampleFilter(override?: Partial<{ category: string; group: string }>) {
  const { bundles } = useSampleBundles();
  const totalCount = useSampleStore((s) => s.samples.length);
  const categories = useUiStore((s) => s.categories);
  const groups = useUiStore((s) => s.groups);
  const minWeight = useUiStore((s) => s.minWeight);
  const maxWeight = useUiStore((s) => s.maxWeight);
  const keyword = useUiStore((s) => s.keyword);
  const sort = useUiStore((s) => s.sort);

  const results = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = bundles
      .filter((b) => {
        const s = b.sample;
        if (categories.length && !categories.includes(s.category)) return false;
        if (groups.length && !groups.includes(s.chemicalGroup)) return false;
        if (minWeight !== null && s.totalWeight < minWeight) return false;
        if (maxWeight !== null && s.totalWeight > maxWeight) return false;
        if (override?.category && s.category !== override.category) return false;
        if (override?.group && s.chemicalGroup !== override.group) return false;
        if (kw) {
          const hay = `${s.sampleNo} ${s.note ?? ''}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      })
      .map((b) => b.sample);
    return sortSamples(list, sort);
  }, [bundles, categories, groups, minWeight, maxWeight, keyword, sort, override?.category, override?.group]);

  return {
    results,
    total: totalCount,
    activeCount:
      categories.length +
      groups.length +
      (minWeight !== null || maxWeight !== null ? 1 : 0) +
      (keyword.trim() ? 1 : 0),
  };
}

export function sortSamples(list: MeteoriteSample[], sort: string): MeteoriteSample[] {
  const copy = [...list];
  switch (sort) {
    case 'totalWeight':
      return copy.sort((a, b) => b.totalWeight - a.totalWeight);
    case 'sampleNo':
      return copy.sort((a, b) => a.sampleNo.localeCompare(b.sampleNo));
    default:
      return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
}
