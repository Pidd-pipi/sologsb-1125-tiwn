import { useMemo } from 'react';
import { useSampleBundles } from './useSampleBundles';
import type { SampleCategory } from '../types/sample';

export interface RegionStat {
  region: string;
  sampleCount: number;
  totalWeight: number;
  categories: Record<string, number>;
  points: { sampleId: string; longitude: number; latitude: number; category: SampleCategory }[];
}

/**
 * 按国家地区聚合样本数与总重量，被 /locations 消费。
 * 数据来自版本化档案簇聚合，详情/总览写入新版本后这里自动重算。
 */
export function useRegionStats() {
  const { bundles } = useSampleBundles();

  return useMemo(() => {
    const map = new Map<string, RegionStat>();
    for (const b of bundles) {
      const f = b.find;
      if (!f) continue;
      const region = f.region?.trim() || '未标注地区';
      const entry =
        map.get(region) ??
        ({ region, sampleCount: 0, totalWeight: 0, categories: {}, points: [] } as RegionStat);
      entry.sampleCount += 1;
      entry.totalWeight += b.sample.totalWeight;
      entry.categories[b.sample.category] = (entry.categories[b.sample.category] ?? 0) + 1;
      entry.points.push({
        sampleId: b.sample.id,
        longitude: f.longitude,
        latitude: f.latitude,
        category: b.sample.category,
      });
      map.set(region, entry);
    }
    const stats = Array.from(map.values()).sort((a, b) => b.sampleCount - a.sampleCount);
    const totalSamples = stats.reduce((n, s) => n + s.sampleCount, 0);
    const totalWeight = stats.reduce((n, s) => n + s.totalWeight, 0);
    const maxCount = stats.length ? Math.max(...stats.map((s) => s.sampleCount)) : 0;
    return { stats, totalSamples, totalWeight, maxCount };
  }, [bundles]);
}
