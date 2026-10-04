import { useMemo } from 'react';
import { useSampleStore } from '../stores/sampleStore';
import { bundleSignature, type SampleBundle } from '../utils/revision';

/**
 * 版本化档案簇聚合：把样本、发现记录、切片与检测记录按样本归簇。
 * 详情、发现地分布、总览筛选都消费这同一份聚合；
 * store 在任一写入后原子刷新四张表，聚合随之重算，不会出现旧汇总。
 */
export function useSampleBundles() {
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);

  return useMemo(() => {
    const findBySample = new Map<string, SampleBundle['find']>();
    for (const f of finds) {
      if (!findBySample.has(f.sampleId)) findBySample.set(f.sampleId, f);
    }
    const sectionsBySample = new Map<string, SampleBundle['sections']>();
    for (const s of sections) {
      const list = sectionsBySample.get(s.sampleId) ?? [];
      list.push(s);
      sectionsBySample.set(s.sampleId, list);
    }
    const analysisBySample = new Map<string, SampleBundle['analysis']>();
    for (const a of analysis) {
      const list = analysisBySample.get(a.sampleId) ?? [];
      list.push(a);
      analysisBySample.set(a.sampleId, list);
    }

    const bundles: SampleBundle[] = samples.map((sample) => ({
      sample,
      find: findBySample.get(sample.id),
      sections: sectionsBySample.get(sample.id) ?? [],
      analysis: analysisBySample.get(sample.id) ?? [],
    }));

    const bundleBySampleId = new Map(bundles.map((b) => [b.sample.id, b]));
    const signatures = new Map(bundles.map((b) => [b.sample.id, bundleSignature(b)]));
    return { bundles, bundleBySampleId, signatures };
  }, [samples, finds, sections, analysis]);
}
