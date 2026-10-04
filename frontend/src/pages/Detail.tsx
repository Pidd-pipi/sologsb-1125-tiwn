import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink, useParams } from 'react-router-dom';
import SampleCard from '../components/common/SampleCard';
import FieldGroup from '../components/common/FieldGroup';
import ClassificationBadge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import ConflictResolutionDialog from '../components/common/ConflictResolutionDialog';
import { useSampleBundles } from '../hooks/useSampleBundles';
import { useSampleStore, type BundleEdits } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
import { db } from '../db';
import {
  ANALYSIS_METHODS,
  ANALYSIS_METHOD_LABELS,
  ANALYSIS_THRESHOLDS,
  type AnalysisMethod,
} from '../types/analysis';
import {
  MINERAL_KEYS,
  MINERAL_LABELS,
  PREPARATIONS,
  PREPARATION_LABELS,
  SECTION_QUALITIES,
  SECTION_QUALITY_LABELS,
  mineralTotal,
  type MineralRatios,
  type PreparationMethod,
  type SectionQuality,
} from '../types/section';
import {
  CATEGORY_LABELS,
  CHEMICAL_GROUP_LABELS,
  CHEMICAL_GROUPS,
  FALL_OR_FIND_LABELS,
  FALL_OR_FINDS,
  SAMPLE_CATEGORIES,
  STORAGE_LABELS,
  STORAGE_LOCATIONS,
  WEATHERING_GRADES,
  WEATHERING_LABELS,
  type ChemicalGroup,
  type FallOrFind,
  type SampleCategory,
  type StorageLocation,
  type WeatheringGrade,
} from '../types/sample';
import {
  COORDINATE_SOURCE_LABELS,
  COORDINATE_SOURCES,
  FIND_ENVIRONMENT_LABELS,
  FIND_ENVIRONMENTS,
  type CoordinateSource,
  type FindEnvironment,
} from '../types/find';
import { classifyByAnalysis, evaluateThresholds } from '../utils/classify';
import { formatDate, formatNumber } from '../utils/format';
import { bundleSignature, type BundleRevisions, type FieldConflict, type MergedField, type ResolutionMap, type SampleBundle } from '../utils/revision';

interface SampleDraft {
  category: SampleCategory;
  chemicalGroup: ChemicalGroup;
  weathering: WeatheringGrade;
  fallOrFind: FallOrFind;
  storage: StorageLocation;
  totalWeight: number;
  note: string;
}

interface FindDraft {
  placeName: string;
  region: string;
  longitude: number;
  latitude: number;
  coordinateSource: CoordinateSource;
  environment: FindEnvironment;
  finder: string;
}

interface SectionDraftState {
  sectionNo: string;
  thickness: number;
  preparation: PreparationMethod;
  quality: SectionQuality;
  micrograph: string;
  minerals: MineralRatios;
}

interface AnalysisDraftState {
  method: AnalysisMethod;
  fa: number;
  fs: number;
  ni: number;
  kamaciteBandwidth: number;
  testedAt: string;
}

interface PendingConflict {
  base: SampleBundle;
  edits: BundleEdits;
  conflicts: FieldConflict[];
  merged: MergedField[];
  expected: BundleRevisions;
}

function sampleDraftOf(b: SampleBundle): SampleDraft {
  return {
    category: b.sample.category,
    chemicalGroup: b.sample.chemicalGroup,
    weathering: b.sample.weathering,
    fallOrFind: b.sample.fallOrFind,
    storage: b.sample.storage,
    totalWeight: b.sample.totalWeight,
    note: b.sample.note ?? '',
  };
}

function findDraftOf(b: SampleBundle): FindDraft {
  const f = b.find;
  return {
    placeName: f?.placeName ?? '',
    region: f?.region ?? '',
    longitude: f?.longitude ?? 0,
    latitude: f?.latitude ?? 0,
    coordinateSource: f?.coordinateSource ?? 'gps',
    environment: f?.environment ?? 'desert',
    finder: f?.finder ?? '',
  };
}

/** `/samples/:id` 样本详情（版本化：四表按修订号一起检查，冲突先裁定后写入） */
export default function Detail() {
  const { id = '' } = useParams();
  const { bundleBySampleId } = useSampleBundles();
  const bundle = bundleBySampleId.get(id);
  const saveBundleRevision = useSampleStore((s) => s.saveBundleRevision);
  const notify = useToastStore((s) => s.notify);

  const signature = bundle ? bundleSignature(bundle) : '';
  /** 编辑基线：表单基于哪个档案簇版本填写；他人推进版本后它保持旧值以触发三方合并 */
  const baseRef = useRef<SampleBundle | null>(null);

  const [sampleDraft, setSampleDraft] = useState<SampleDraft | null>(null);
  const [findDraft, setFindDraft] = useState<FindDraft | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [sectionDraft, setSectionDraft] = useState<SectionDraftState>({
    sectionNo: '',
    thickness: 30,
    preparation: 'resin',
    quality: 'unrated',
    micrograph: '',
    minerals: { olivine: 40, pyroxene: 25, feldspar: 15, metal: 20 },
  });
  const [analysisDraft, setAnalysisDraft] = useState<AnalysisDraftState>({
    method: 'microprobe',
    fa: 18,
    fs: 16,
    ni: 0.8,
    kamaciteBandwidth: 0.05,
    testedAt: new Date().toISOString().slice(0, 10),
  });

  const [conflict, setConflict] = useState<PendingConflict | null>(null);

  // 切换到另一个样本：重置编辑基线、表单与裁定状态
  const prevIdRef = useRef(id);
  if (prevIdRef.current !== id) {
    prevIdRef.current = id;
    baseRef.current = null;
    setConflict(null);
    setExternalChange(false);
    setSubmitting(false);
    setSampleDraft(null);
    setFindDraft(null);
  }

  // 首次进入该样本：以当前版本作为编辑基线并填充表单
  if (bundle && !sampleDraft) {
    baseRef.current = bundle;
    setSampleDraft(sampleDraftOf(bundle));
    setFindDraft(findDraftOf(bundle));
  }

  // 档案簇版本在编辑期间被他人推进：提示旧汇总，不抹掉本次输入
  if (bundle && baseRef.current && bundleSignature(baseRef.current) !== signature) {
    if (!submitting && !conflict) setExternalChange(true);
  }

  const mergedSummary = (merged: MergedField[]) =>
    merged.length ? `；已自动合并对方 ${merged.length} 个字段` : '';

  /** 通用提交：基线落后时先列冲突、保留本次输入，裁定后再写新版本 */
  const commit = async (edits: BundleEdits, successMsg: string) => {
    const base = baseRef.current;
    if (!base || !bundle) return false;
    setSubmitting(true);
    try {
      const res = await saveBundleRevision({ sampleId: id, base, edits });
      if (res.ok) {
        const latest = await getLatestBundle(id);
        if (latest) {
          baseRef.current = latest;
          setSampleDraft(sampleDraftOf(latest));
          setFindDraft(findDraftOf(latest));
        }
        setExternalChange(false);
        setConflict(null);
        notify(`${successMsg}，档案簇修订号升至 r${res.revision}`);
        return true;
      }
      if (res.reason === 'missing') {
        notify('该样本已被删除', 'warning');
        return false;
      }
      // stale：弹出冲突裁定（本次输入默认保留）
      setConflict({
        base,
        edits,
        conflicts: res.conflicts,
        merged: res.merged,
        expected: res.currentRevisions,
      });
      if (!res.conflicts.length) {
        notify(`检测到对方已保存新版本${mergedSummary(res.merged)}，请确认裁定后写入`, 'warning');
      } else {
        notify(
          `版本落后：${res.conflicts.length} 个字段冲突待裁定${mergedSummary(res.merged)}`,
          'warning',
        );
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const submitSample = async () => {
    if (!bundle || !sampleDraft) return;
    const edits: BundleEdits = {
      sample: {
        category: sampleDraft.category,
        chemicalGroup: sampleDraft.chemicalGroup,
        weathering: sampleDraft.weathering,
        fallOrFind: sampleDraft.fallOrFind,
        storage: sampleDraft.storage,
        totalWeight: Number(sampleDraft.totalWeight),
        note: sampleDraft.note.trim() || undefined,
      },
    };
    await commit(edits, `已保存 ${bundle.sample.sampleNo} 的分类 / 风化 / 存放信息`);
  };

  const submitFind = async () => {
    if (!bundle || !findDraft) return;
    const list: string[] = [];
    if (!findDraft.placeName.trim()) list.push('发现地名不能为空');
    if (!findDraft.region.trim()) list.push('国家地区不能为空');
    if (list.length) {
      notify(list.join('；'), 'warning');
      return;
    }
    const payload = {
      placeName: findDraft.placeName.trim(),
      region: findDraft.region.trim(),
      longitude: Number(findDraft.longitude),
      latitude: Number(findDraft.latitude),
      coordinateSource: findDraft.coordinateSource,
      environment: findDraft.environment,
      finder: findDraft.finder.trim() || '未署名',
    };
    const edits: BundleEdits = baseRef.current?.find
      ? { find: { id: baseRef.current.find.id, ...payload } }
      : { find: payload };
    await commit(edits, `已保存 ${bundle.sample.sampleNo} 的发现地信息`);
  };

  const submitSection = async () => {
    if (!bundle) return;
    const no =
      sectionDraft.sectionNo.trim() ||
      `TS-${new Date().getFullYear()}-${String(bundle.sections.length + 1).padStart(3, '0')}`;
    const ok = await commit(
      {
        sections: [
          {
            sectionNo: no,
            thickness: Number(sectionDraft.thickness),
            preparation: sectionDraft.preparation,
            minerals: sectionDraft.minerals,
            micrographs: sectionDraft.micrograph.trim() ? [sectionDraft.micrograph.trim()] : [],
            quality: sectionDraft.quality,
          },
        ],
      },
      `已为 ${bundle.sample.sampleNo} 新增切片 ${no}`,
    );
    if (ok) setSectionDraft((d) => ({ ...d, sectionNo: '', micrograph: '' }));
  };

  const submitAnalysis = async () => {
    if (!bundle) return;
    await commit(
      {
        analysis: [
          {
            target: 'sample',
            sectionId: undefined,
            method: analysisDraft.method,
            fa: Number(analysisDraft.fa),
            fs: Number(analysisDraft.fs),
            ni: Number(analysisDraft.ni),
            kamaciteBandwidth: Number(analysisDraft.kamaciteBandwidth),
            testedAt: analysisDraft.testedAt,
          },
        ],
      },
      `已为 ${bundle.sample.sampleNo} 写入一条检测记录`,
    );
  };

  const confirmResolutions = async (resolutions: ResolutionMap) => {
    if (!conflict) return;
    setSubmitting(true);
    try {
      const res = await saveBundleRevision({
        sampleId: id,
        base: conflict.base,
        edits: conflict.edits,
        expected: conflict.expected,
        resolutions,
      });
      if (res.ok) {
        const latest = await getLatestBundle(id);
        if (latest) {
          baseRef.current = latest;
          setSampleDraft(sampleDraftOf(latest));
          setFindDraft(findDraftOf(latest));
        }
        setConflict(null);
        setExternalChange(false);
        notify(`冲突已裁定并写入，档案簇修订号升至 r${res.revision}`);
      } else if (res.reason === 'stale') {
        setConflict((c) =>
          c
            ? { ...c, conflicts: res.conflicts, merged: res.merged, expected: res.currentRevisions }
            : c,
        );
        notify('裁定期间版本又有更新，出现新的冲突字段，请再次确认', 'warning');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!bundle || !sampleDraft || !findDraft) {
    return (
      <Stack spacing={2}>
        <EmptyState
          title="未找到该样本档案"
          description={`样本 id「${id}」不在本地库中，可能已被删除或链接失效。`}
          actionLabel="返回样本总览"
          actionTo="/"
        />
      </Stack>
    );
  }

  const sample = bundle.sample;
  const find = bundle.find;
  const mySections = bundle.sections;
  const myAnalysis = bundle.analysis;
  const mineralSum = mineralTotal(sectionDraft.minerals);
  const advice = classifyByAnalysis(analysisDraft);
  const hits = evaluateThresholds(analysisDraft);

  const reloadForms = () => {
    baseRef.current = bundle;
    setSampleDraft(sampleDraftOf(bundle));
    setFindDraft(findDraftOf(bundle));
    setExternalChange(false);
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />} variant="text">
          返回总览
        </Button>
        <Typography variant="h4">样本详情</Typography>
        <Chip size="small" color="primary" variant="outlined" label={`档案簇修订 r${sample.revision}`} />
        <Chip
          size="small"
          variant="outlined"
          component="span"
          label={`四表修订号：样本 r${sample.revision} · 发现 ${find ? `r${find.revision}` : '无'} · 切片 ${
            mySections.length ? mySections.map((s) => `r${s.revision}`).join('/') : '无'
          } · 检测 ${myAnalysis.length ? myAnalysis.map((a) => `r${a.revision}`).join('/') : '无'}`}
        />
      </Stack>

      {externalChange ? (
        <Alert
          severity="warning"
          action={
            <Button size="small" startIcon={<RefreshIcon />} onClick={reloadForms}>
              载入新版本并重填表单
            </Button>
          }
        >
          该档案簇在你编辑期间已被他人保存到更新的修订号，当前表单基线已落后。继续保存会进入字段冲突裁定；
          也可以先载入新版本（本次未保存的输入将被覆盖）。
        </Alert>
      ) : null}

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={4}>
          <SampleCard
            sample={sample}
            find={find}
            sectionCount={mySections.length}
            analysisCount={myAnalysis.length}
          />
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Stack spacing={1.5}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">基本信息（可编辑）</Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={submitting}
                  onClick={submitSample}
                  id="save-sample-fields"
                >
                  保存基本信息
                </Button>
              </Stack>
              <ClassificationBadge category={sampleDraft.category} group={sampleDraft.chemicalGroup} size="medium" />
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="d-category-label">分类</InputLabel>
                  <Select
                    labelId="d-category-label"
                    label="分类"
                    value={sampleDraft.category}
                    onChange={(e) => setSampleDraft((d) => d && { ...d, category: e.target.value as SampleCategory })}
                  >
                    {SAMPLE_CATEGORIES.map((c) => (
                      <MenuItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel id="d-group-label">化学群</InputLabel>
                  <Select
                    labelId="d-group-label"
                    label="化学群"
                    value={sampleDraft.chemicalGroup}
                    onChange={(e) => setSampleDraft((d) => d && { ...d, chemicalGroup: e.target.value as ChemicalGroup })}
                  >
                    {CHEMICAL_GROUPS.map((g) => (
                      <MenuItem key={g} value={g}>
                        {CHEMICAL_GROUP_LABELS[g]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="d-weathering-label">风化等级</InputLabel>
                  <Select
                    labelId="d-weathering-label"
                    label="风化等级"
                    value={sampleDraft.weathering}
                    onChange={(e) => setSampleDraft((d) => d && { ...d, weathering: e.target.value as WeatheringGrade })}
                  >
                    {WEATHERING_GRADES.map((w) => (
                      <MenuItem key={w} value={w}>
                        {WEATHERING_LABELS[w]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel id="d-fallfind-label">发现/坠落</InputLabel>
                  <Select
                    labelId="d-fallfind-label"
                    label="发现/坠落"
                    value={sampleDraft.fallOrFind}
                    onChange={(e) => setSampleDraft((d) => d && { ...d, fallOrFind: e.target.value as FallOrFind })}
                  >
                    {FALL_OR_FINDS.map((f) => (
                      <MenuItem key={f} value={f}>
                        {FALL_OR_FIND_LABELS[f]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel id="d-storage-label">存放位置</InputLabel>
                  <Select
                    labelId="d-storage-label"
                    label="存放位置"
                    value={sampleDraft.storage}
                    onChange={(e) => setSampleDraft((d) => d && { ...d, storage: e.target.value as StorageLocation })}
                  >
                    {STORAGE_LOCATIONS.map((s) => (
                      <MenuItem key={s} value={s}>
                        {STORAGE_LABELS[s]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FieldGroup
                  title="总重量"
                  unit="g"
                  min={0.1}
                  max={200000}
                  value={sampleDraft.totalWeight}
                  onChange={(v) => setSampleDraft((d) => d && { ...d, totalWeight: v })}
                  inputId="detail-total-weight"
                  label="总重量"
                />
              </Stack>
              <TextField
                size="small"
                label="备注"
                value={sampleDraft.note}
                onChange={(e) => setSampleDraft((d) => d && { ...d, note: e.target.value })}
                multiline
                minRows={1.5}
              />
              <Typography variant="caption" color="text.secondary">
                编号 {sample.sampleNo} · 登记 {formatDate(sample.createdAt)} / 更新 {formatDate(sample.updatedAt)}
              </Typography>

              <Divider />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">发现地信息{find ? '（可编辑）' : '（尚未登记，可在此补录）'}</Typography>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  disabled={submitting}
                  onClick={submitFind}
                  id="save-find-fields"
                >
                  {find ? '保存发现地' : '补录发现地'}
                </Button>
              </Stack>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  id="detail-place-name"
                  size="small"
                  label="发现地名"
                  value={findDraft.placeName}
                  onChange={(e) => setFindDraft((d) => d && { ...d, placeName: e.target.value })}
                  sx={{ width: 200 }}
                />
                <TextField
                  id="detail-region"
                  size="small"
                  label="国家 / 地区"
                  value={findDraft.region}
                  onChange={(e) => setFindDraft((d) => d && { ...d, region: e.target.value })}
                  sx={{ width: 170 }}
                />
                <TextField
                  id="detail-lng"
                  size="small"
                  type="number"
                  label="经度"
                  value={findDraft.longitude}
                  onChange={(e) => setFindDraft((d) => d && { ...d, longitude: Number(e.target.value) })}
                  sx={{ width: 130 }}
                />
                <TextField
                  id="detail-lat"
                  size="small"
                  type="number"
                  label="纬度"
                  value={findDraft.latitude}
                  onChange={(e) => setFindDraft((d) => d && { ...d, latitude: Number(e.target.value) })}
                  sx={{ width: 130 }}
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="d-coord-label">坐标来源</InputLabel>
                  <Select
                    labelId="d-coord-label"
                    label="坐标来源"
                    value={findDraft.coordinateSource}
                    onChange={(e) =>
                      setFindDraft((d) => d && { ...d, coordinateSource: e.target.value as CoordinateSource })
                    }
                  >
                    {COORDINATE_SOURCES.map((c) => (
                      <MenuItem key={c} value={c}>
                        {COORDINATE_SOURCE_LABELS[c]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="d-env-label">发现环境</InputLabel>
                  <Select
                    labelId="d-env-label"
                    label="发现环境"
                    value={findDraft.environment}
                    onChange={(e) =>
                      setFindDraft((d) => d && { ...d, environment: e.target.value as FindEnvironment })
                    }
                  >
                    {FIND_ENVIRONMENTS.map((c) => (
                      <MenuItem key={c} value={c}>
                        {FIND_ENVIRONMENT_LABELS[c]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  id="detail-finder"
                  size="small"
                  label="发现者"
                  value={findDraft.finder}
                  onChange={(e) => setFindDraft((d) => d && { ...d, finder: e.target.value })}
                  sx={{ width: 160 }}
                />
              </Stack>
              {find ? (
                <Typography variant="caption" color="text.secondary">
                  发现记录修订 r{find.revision}
                </Typography>
              ) : null}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              切片与制样（{mySections.length}）
            </Typography>
            {mySections.length === 0 ? (
              <Alert severity="info">暂无切片记录，可在下方就地新增。</Alert>
            ) : (
              <Stack spacing={1.25}>
                {mySections.map((s) => (
                  <Box
                    key={s.id}
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                  >
                    <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {s.sectionNo}
                      </Typography>
                      <Stack direction="row" spacing={0.75}>
                        <Chip size="small" label={`厚度 ${s.thickness} μm`} />
                        <Chip size="small" variant="outlined" label={PREPARATION_LABELS[s.preparation]} />
                        <Chip size="small" color="secondary" label={SECTION_QUALITY_LABELS[s.quality]} />
                        <Chip size="small" variant="outlined" label={`r${s.revision}`} />
                      </Stack>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      矿物占比：{MINERAL_KEYS.map((k) => `${MINERAL_LABELS[k]} ${s.minerals[k]}%`).join(' · ')}
                      （合计 {mineralTotal(s.minerals)}%）
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      显微照片：{s.micrographs.length ? s.micrographs.join('、') : '未上传'}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              就地新增切片
            </Typography>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  id="section-no"
                  size="small"
                  label="切片编号"
                  value={sectionDraft.sectionNo}
                  onChange={(e) => setSectionDraft((d) => ({ ...d, sectionNo: e.target.value }))}
                  sx={{ width: 180 }}
                />
                <TextField
                  id="section-thickness"
                  size="small"
                  type="number"
                  label="厚度 μm"
                  value={sectionDraft.thickness}
                  onChange={(e) => setSectionDraft((d) => ({ ...d, thickness: Number(e.target.value) }))}
                  sx={{ width: 140 }}
                />
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="prep-label">制样方式</InputLabel>
                  <Select
                    labelId="prep-label"
                    label="制样方式"
                    value={sectionDraft.preparation}
                    onChange={(e) =>
                      setSectionDraft((d) => ({ ...d, preparation: e.target.value as PreparationMethod }))
                    }
                  >
                    {PREPARATIONS.map((p) => (
                      <MenuItem key={p} value={p}>
                        {PREPARATION_LABELS[p]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel id="quality-label">质量标注</InputLabel>
                  <Select
                    labelId="quality-label"
                    label="质量标注"
                    value={sectionDraft.quality}
                    onChange={(e) =>
                      setSectionDraft((d) => ({ ...d, quality: e.target.value as SectionQuality }))
                    }
                  >
                    {SECTION_QUALITIES.map((q) => (
                      <MenuItem key={q} value={q}>
                        {SECTION_QUALITY_LABELS[q]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  id="section-micrograph"
                  size="small"
                  label="显微照片文件名"
                  value={sectionDraft.micrograph}
                  onChange={(e) => setSectionDraft((d) => ({ ...d, micrograph: e.target.value }))}
                  sx={{ width: 220 }}
                />
              </Stack>

              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                {MINERAL_KEYS.map((k) => (
                  <FieldGroup
                    key={k}
                    title={`${MINERAL_LABELS[k]}占比`}
                    unit="%"
                    min={0}
                    max={100}
                    value={sectionDraft.minerals[k]}
                    onChange={(v) =>
                      setSectionDraft((d) => ({ ...d, minerals: { ...d.minerals, [k]: v } }))
                    }
                    inputId={`mineral-${k}`}
                    label={MINERAL_LABELS[k]}
                  />
                ))}
              </Stack>
              <Typography variant="caption" color={mineralSum === 100 ? 'success.main' : 'warning.main'}>
                矿物占比合计 {mineralSum}%（建议合计 100%）
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => void submitSection()}
                id="add-section"
                disabled={submitting}
                sx={{ alignSelf: 'flex-start' }}
              >
                新增切片
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              分析检测记录（{myAnalysis.length}）
            </Typography>
            {myAnalysis.length === 0 ? (
              <Alert severity="info">暂无检测记录。</Alert>
            ) : (
              <Stack spacing={1.25} sx={{ mb: 2 }}>
                {myAnalysis.map((a) => {
                  const a2 = classifyByAnalysis(a);
                  return (
                    <Box
                      key={a.id}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
                    >
                      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
                        <Typography variant="subtitle2">
                          {ANALYSIS_METHOD_LABELS[a.method]} · {a.testedAt}
                        </Typography>
                        <Stack direction="row" spacing={0.5}>
                          <ClassificationBadge category={a2.category} showGroup={false} />
                          <Chip size="small" variant="outlined" label={`r${a.revision}`} />
                        </Stack>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Fa {formatNumber(a.fa, 2, ' mol%')} · Fs {formatNumber(a.fs, 2, ' mol%')} · Ni{' '}
                        {formatNumber(a.ni, 2, ' wt%')} · 带宽 {formatNumber(a.kamaciteBandwidth, 3, ' mm')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {a2.summary}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              就地录入检测数值
            </Typography>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="method-label">检测方法</InputLabel>
                  <Select
                    labelId="method-label"
                    label="检测方法"
                    value={analysisDraft.method}
                    onChange={(e) =>
                      setAnalysisDraft((d) => ({ ...d, method: e.target.value as AnalysisMethod }))
                    }
                  >
                    {ANALYSIS_METHODS.map((m) => (
                      <MenuItem key={m} value={m}>
                        {ANALYSIS_METHOD_LABELS[m]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  id="detail-tested-at"
                  size="small"
                  type="date"
                  label="检测日期"
                  InputLabelProps={{ shrink: true }}
                  value={analysisDraft.testedAt}
                  onChange={(e) => setAnalysisDraft((d) => ({ ...d, testedAt: e.target.value }))}
                  sx={{ width: 180 }}
                />
              </Stack>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FieldGroup
                  title="橄榄石 Fa"
                  unit="mol%"
                  min={0}
                  max={30}
                  value={analysisDraft.fa}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, fa: v }))}
                  inputId="detail-fa"
                  label="Fa"
                />
                <FieldGroup
                  title="辉石 Fs"
                  unit="mol%"
                  min={0}
                  max={30}
                  value={analysisDraft.fs}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, fs: v }))}
                  inputId="detail-fs"
                  label="Fs"
                />
                <FieldGroup
                  title="Ni 含量"
                  unit="wt%"
                  min={0}
                  max={20}
                  value={analysisDraft.ni}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, ni: v }))}
                  inputId="detail-ni"
                  label="Ni"
                />
                <FieldGroup
                  title="铁纹石带宽"
                  unit="mm"
                  min={0}
                  max={2}
                  value={analysisDraft.kamaciteBandwidth}
                  onChange={(v) => setAnalysisDraft((d) => ({ ...d, kamaciteBandwidth: v }))}
                  inputId="detail-band"
                  label="带宽"
                />
              </Stack>
              <Alert severity={hits.every((h) => h.inRange) ? 'success' : 'warning'}>
                分类建议：{advice.summary}
                <br />
                阈值命中：{hits.filter((h) => h.inRange).length}/{hits.length} 项落在常规区间
                <br />
                命中说明：{advice.hits.join('；')}
              </Alert>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => void submitAnalysis()}
                id="add-analysis"
                disabled={submitting}
                sx={{ alignSelf: 'flex-start' }}
              >
                写入检测记录
              </Button>
              <Typography variant="caption" color="text.secondary">
                阈值参考：
                {ANALYSIS_THRESHOLDS.map((t) => `${t.label} ${t.min}~${t.max}${t.unit}`).join(' · ')}
              </Typography>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <ConflictResolutionDialog
        open={!!conflict}
        conflicts={conflict?.conflicts ?? []}
        merged={conflict?.merged ?? []}
        revisionNote={
          conflict ? `对方样本修订号 r${conflict.expected.sample}` : undefined
        }
        onCancel={() => setConflict(null)}
        onConfirm={(r) => void confirmResolutions(r)}
      />
    </Stack>
  );
}

/** 保存成功后直接从库内重读最新档案簇（不依赖 zustand 重渲染时序） */
async function getLatestBundle(sampleId: string): Promise<SampleBundle | undefined> {
  const sample = await db.samples.get(sampleId);
  if (!sample) return undefined;
  const [finds, sections, analysis] = await Promise.all([
    db.finds.where('sampleId').equals(sampleId).toArray(),
    db.sections.where('sampleId').equals(sampleId).toArray(),
    db.analysis.where('sampleId').equals(sampleId).toArray(),
  ]);
  const byCreated = <T extends { createdAt: number }>(a: T, b: T) => b.createdAt - a.createdAt;
  return {
    sample,
    find: finds[0],
    sections: sections.sort(byCreated),
    analysis: analysis.sort(byCreated),
  };
}
