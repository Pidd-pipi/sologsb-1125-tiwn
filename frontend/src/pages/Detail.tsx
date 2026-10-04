import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink, useParams } from 'react-router-dom';
import SampleCard from '../components/common/SampleCard';
import FieldGroup from '../components/common/FieldGroup';
import ClassificationBadge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import ConflictDialog from '../components/ConflictDialog';
import { useSampleStore } from '../stores/sampleStore';
import { useToastStore } from '../stores/uiStore';
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
  FALL_OR_FIND_LABELS,
  FALL_OR_FINDS,
  STORAGE_LABELS,
  STORAGE_LOCATIONS,
  WEATHERING_LABELS,
  WEATHERING_GRADES,
  SAMPLE_CATEGORIES,
  CHEMICAL_GROUPS,
  CHEMICAL_GROUP_LABELS,
  CATEGORY_LABELS,
  type ChemicalGroup,
  type FallOrFind,
  type SampleCategory,
  type StorageLocation,
  type WeatheringGrade,
  type MeteoriteSample,
} from '../types/sample';
import {
  FIND_ENVIRONMENT_LABELS,
  FIND_ENVIRONMENTS,
  COORDINATE_SOURCE_LABELS,
  COORDINATE_SOURCES,
  type CoordinateSource,
  type FindEnvironment,
  type FindRecord,
} from '../types/find';
import { classifyByAnalysis, evaluateThresholds } from '../utils/classify';
import { formatDate, formatNumber, formatWeight } from '../utils/format';
import { formatCoordinate } from '../utils/geo';
import {
  aggregateStale,
  snapshotOf,
  type AggregateSnapshot,
  type FieldConflict,
} from '../utils/revision';

/** 变化键 → 中文标签 */
function changedKeyLabel(key: string): string {
  if (key === 'sample') return '样本信息';
  if (key === 'find') return '发现地';
  if (key.startsWith('section:')) return '切片';
  if (key.startsWith('analysis:')) return '检测记录';
  return key;
}

/** `/samples/:id` 样本详情 */
export default function Detail() {
  const { id = '' } = useParams();
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const addSection = useSampleStore((s) => s.addSection);
  const addAnalysis = useSampleStore((s) => s.addAnalysis);
  const updateSample = useSampleStore((s) => s.updateSample);
  const commitSampleEdit = useSampleStore((s) => s.commitSampleEdit);
  const commitFindEdit = useSampleStore((s) => s.commitFindEdit);
  const reloadAggregate = useSampleStore((s) => s.reloadAggregate);
  const notify = useToastStore((s) => s.notify);

  const sample = useMemo(() => samples.find((s) => s.id === id), [samples, id]);
  const find = useMemo(() => finds.find((f) => f.sampleId === id), [finds, id]);
  const mySections = useMemo(() => sections.filter((s) => s.sampleId === id), [sections, id]);
  const myAnalysis = useMemo(() => analysis.filter((a) => a.sampleId === id), [analysis, id]);

  // 详情页打开时的修订号快照
  const [snapshot, setSnapshot] = useState<AggregateSnapshot | null>(null);
  // 是否落后于当前档案
  const [stale, setStale] = useState(false);
  const [changedKeys, setChangedKeys] = useState<string[]>([]);

  // 样本编辑对话框
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<Partial<MeteoriteSample>>({});

  // 发现记录编辑对话框
  const [findEditOpen, setFindEditOpen] = useState(false);
  const [findDraft, setFindDraft] = useState<Partial<FindRecord>>({});

  // 冲突裁定对话框
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflicts, setConflicts] = useState<FieldConflict[]>([]);
  const [conflictBaseRevision, setConflictBaseRevision] = useState<number>(0);
  const [conflictKind, setConflictKind] = useState<'sample' | 'find'>('sample');

  const [sectionDraft, setSectionDraft] = useState({
    sectionNo: '',
    thickness: 30,
    preparation: 'resin' as PreparationMethod,
    quality: 'unrated' as SectionQuality,
    micrograph: '',
    minerals: { olivine: 40, pyroxene: 25, feldspar: 15, metal: 20 } as MineralRatios,
  });
  const [analysisDraft, setAnalysisDraft] = useState({
    method: 'microprobe' as AnalysisMethod,
    fa: 18,
    fs: 16,
    ni: 0.8,
    kamaciteBandwidth: 0.05,
    testedAt: new Date().toISOString().slice(0, 10),
  });

  // 挂载或 id 变化时从 DB 重新读取聚合数据并建立修订号快照
  useEffect(() => {
    let cancelled = false;
    reloadAggregate(id).then((agg) => {
      if (cancelled || !agg) return;
      setSnapshot(snapshotOf(agg));
      setStale(false);
      setChangedKeys([]);
    });
    return () => {
      cancelled = true;
    };
  }, [id, reloadAggregate]);

  // 当 store 数据变化（跨标签页重载或本页写入）时，检查快照是否落后
  useEffect(() => {
    if (!snapshot || !sample) return;
    const current = snapshotOf({ sample, find, sections: mySections, analysis: myAnalysis });
    const { stale: isStale, changedKeys: keys } = aggregateStale(current, snapshot);
    setStale(isStale);
    setChangedKeys(keys);
  }, [sample, find, mySections, myAnalysis, snapshot]);

  if (!sample) {
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

  const mineralSum = mineralTotal(sectionDraft.minerals);
  const advice = classifyByAnalysis(analysisDraft);
  const hits = evaluateThresholds(analysisDraft);

  const uniqueChangedLabels = Array.from(new Set(changedKeys.map(changedKeyLabel)));

  const handleRefresh = async () => {
    const agg = await reloadAggregate(id);
    if (agg) {
      setSnapshot(snapshotOf(agg));
      setStale(false);
      setChangedKeys([]);
      notify('已刷新为最新档案');
    }
  };

  // ── 样本编辑 ──────────────────────────────────────────────
  const openEdit = () => {
    setEditDraft({
      sampleNo: sample.sampleNo,
      totalWeight: sample.totalWeight,
      category: sample.category,
      chemicalGroup: sample.chemicalGroup,
      weathering: sample.weathering,
      fallOrFind: sample.fallOrFind,
      storage: sample.storage,
      note: sample.note ?? '',
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!snapshot) return;
    const patch: Partial<MeteoriteSample> = {
      ...editDraft,
      note: editDraft.note?.trim() || undefined,
    };
    const result = await commitSampleEdit(sample.id, snapshot.sampleRevision, patch);
    if (result.ok) {
      setSnapshot((prev) =>
        prev ? { ...prev, sampleRevision: prev.sampleRevision + 1 } : prev,
      );
      setEditOpen(false);
      notify('样本档案已更新');
    } else if (result.deleted) {
      notify('该样本已被删除', 'warning');
      setEditOpen(false);
    } else if (result.conflicts && result.current) {
      setConflicts(result.conflicts);
      setConflictBaseRevision((result.current as MeteoriteSample).revision);
      setConflictKind('sample');
      setConflictOpen(true);
    }
  };

  const resolveSampleConflict = async (resolved: Record<string, unknown>) => {
    const result = await commitSampleEdit(
      sample.id,
      conflictBaseRevision,
      resolved as Partial<MeteoriteSample>,
    );
    if (result.ok) {
      setSnapshot((prev) =>
        prev ? { ...prev, sampleRevision: conflictBaseRevision + 1 } : prev,
      );
      setConflictOpen(false);
      setEditOpen(false);
      notify('样本档案已更新');
    } else if (result.deleted) {
      notify('该样本已被删除', 'warning');
      setConflictOpen(false);
      setEditOpen(false);
    } else if (result.conflicts && result.current) {
      setConflicts(result.conflicts);
      setConflictBaseRevision((result.current as MeteoriteSample).revision);
    }
  };

  // ── 发现记录编辑 ──────────────────────────────────────────
  const openFindEdit = () => {
    if (find) {
      setFindDraft({
        placeName: find.placeName,
        region: find.region,
        longitude: find.longitude,
        latitude: find.latitude,
        coordinateSource: find.coordinateSource,
        environment: find.environment,
        finder: find.finder,
      });
    } else {
      setFindDraft({
        placeName: '',
        region: '',
        longitude: 0,
        latitude: 0,
        coordinateSource: 'gps',
        environment: 'desert',
        finder: '',
      });
    }
    setFindEditOpen(true);
  };

  const submitFindEdit = async () => {
    if (!snapshot) return;
    const patch: Partial<FindRecord> = {
      ...findDraft,
      finder: findDraft.finder?.trim() || '未署名',
    };
    const result = await commitFindEdit(
      sample.id,
      find ? snapshot.findRevision ?? 0 : null,
      patch,
      !find,
    );
    if (result.ok) {
      setSnapshot((prev) =>
        prev
          ? { ...prev, findRevision: find ? (prev.findRevision ?? 0) + 1 : 1 }
          : prev,
      );
      setFindEditOpen(false);
      notify(find ? '发现记录已更新' : '已补录发现地');
    } else if (result.deleted) {
      notify('该样本已被删除', 'warning');
      setFindEditOpen(false);
    } else if (result.conflicts && result.current) {
      setConflicts(result.conflicts);
      setConflictBaseRevision((result.current as FindRecord).revision);
      setConflictKind('find');
      setConflictOpen(true);
    }
  };

  const resolveFindConflict = async (resolved: Record<string, unknown>) => {
    const result = await commitFindEdit(
      sample.id,
      conflictBaseRevision,
      resolved as Partial<FindRecord>,
      false,
    );
    if (result.ok) {
      setSnapshot((prev) =>
        prev ? { ...prev, findRevision: conflictBaseRevision + 1 } : prev,
      );
      setConflictOpen(false);
      setFindEditOpen(false);
      notify('发现记录已更新');
    } else if (result.deleted) {
      notify('该样本已被删除', 'warning');
      setConflictOpen(false);
      setFindEditOpen(false);
    } else if (result.conflicts && result.current) {
      setConflicts(result.conflicts);
      setConflictBaseRevision((result.current as FindRecord).revision);
    }
  };

  // ── 切片与检测记录新增 ────────────────────────────────────
  const submitSection = async () => {
    const no =
      sectionDraft.sectionNo.trim() ||
      `TS-${new Date().getFullYear()}-${mySections.length + 1}`.padEnd(3, '0');
    await addSection({
      sectionNo: no,
      sampleId: sample.id,
      thickness: Number(sectionDraft.thickness),
      preparation: sectionDraft.preparation,
      minerals: sectionDraft.minerals,
      micrographs: sectionDraft.micrograph.trim() ? [sectionDraft.micrograph.trim()] : [],
      quality: sectionDraft.quality,
    });
    notify(`已为 ${sample.sampleNo} 新增切片 ${no}`);
    setSectionDraft((d) => ({ ...d, sectionNo: '', micrograph: '' }));
  };

  const submitAnalysis = async () => {
    await addAnalysis({
      sampleId: sample.id,
      target: 'sample',
      method: analysisDraft.method,
      fa: Number(analysisDraft.fa),
      fs: Number(analysisDraft.fs),
      ni: Number(analysisDraft.ni),
      kamaciteBandwidth: Number(analysisDraft.kamaciteBandwidth),
      testedAt: analysisDraft.testedAt,
    });
    notify(`已为 ${sample.sampleNo} 写入一条检测记录`);
  };

  const toggleStorage = () => {
    void updateSample(sample.id, {
      storage: sample.storage === 'loan-out' ? 'cabinet-a' : 'loan-out',
    });
    setSnapshot((prev) =>
      prev ? { ...prev, sampleRevision: prev.sampleRevision + 1 } : prev,
    );
    notify('已切换存放状态');
  };

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />} variant="text">
          返回总览
        </Button>
        <Typography variant="h4">样本详情</Typography>
      </Stack>

      {stale ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={handleRefresh}>
              刷新为最新档案
            </Button>
          }
        >
          档案已被其他标签页更新（{uniqueChangedLabels.join('、')}），当前显示的是较早的修订版本。
          刷新后再编辑可避免覆盖他人修改。
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
                <Typography variant="h6">基本信息</Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={openEdit}>
                    编辑档案
                  </Button>
                  <Button size="small" variant="outlined" onClick={toggleStorage}>
                    切换存放状态
                  </Button>
                </Stack>
              </Stack>
              <ClassificationBadge
                category={sample.category}
                group={sample.chemicalGroup}
                size="medium"
              />
              <Grid container spacing={1.5}>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    编号
                  </Typography>
                  <Typography variant="body1">{sample.sampleNo}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    总重量
                  </Typography>
                  <Typography variant="body1">{formatWeight(sample.totalWeight)}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    风化等级
                  </Typography>
                  <Typography variant="body1">{WEATHERING_LABELS[sample.weathering]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    发现 / 坠落
                  </Typography>
                  <Typography variant="body1">{FALL_OR_FIND_LABELS[sample.fallOrFind]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    存放位置
                  </Typography>
                  <Typography variant="body1">{STORAGE_LABELS[sample.storage]}</Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    登记 / 更新
                  </Typography>
                  <Typography variant="body1">
                    {formatDate(sample.createdAt)} / {formatDate(sample.updatedAt)}
                  </Typography>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Typography variant="caption" color="text.secondary">
                    修订号
                  </Typography>
                  <Typography variant="body1">第 {sample.revision} 版</Typography>
                </Grid>
              </Grid>
              {sample.note ? (
                <Typography variant="body2" color="text.secondary">
                  备注：{sample.note}
                </Typography>
              ) : null}
              <Divider />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">发现地摘要</Typography>
                <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={openFindEdit}>
                  {find ? '编辑发现地' : '补录发现地'}
                </Button>
              </Stack>
              {find ? (
                <Grid container spacing={1.5}>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      地名
                    </Typography>
                    <Typography variant="body2">{find.placeName}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      国家 / 地区
                    </Typography>
                    <Typography variant="body2">{find.region}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      坐标
                    </Typography>
                    <Typography variant="body2">
                      {formatCoordinate(find.longitude, find.latitude)}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      坐标来源
                    </Typography>
                    <Typography variant="body2">
                      {COORDINATE_SOURCE_LABELS[find.coordinateSource]}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      发现环境
                    </Typography>
                    <Typography variant="body2">
                      {FIND_ENVIRONMENT_LABELS[find.environment]}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary">
                      发现者
                    </Typography>
                    <Typography variant="body2">{find.finder}</Typography>
                  </Grid>
                </Grid>
              ) : (
                <Alert severity="warning">
                  该样本尚未登记发现地坐标，可点击右上角「补录发现地」就地登记。
                </Alert>
              )}
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
                onClick={submitSection}
                id="add-section"
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
                        <ClassificationBadge category={a2.category} showGroup={false} />
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
                onClick={submitAnalysis}
                id="add-analysis"
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

      {/* 样本编辑对话框 */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>编辑样本档案</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField
              size="small"
              label="样本编号"
              value={editDraft.sampleNo ?? ''}
              onChange={(e) => setEditDraft((d) => ({ ...d, sampleNo: e.target.value }))}
            />
            <FieldGroup title="总重量" unit="g" min={0.1} max={200000} value={editDraft.totalWeight ?? 0}
              onChange={(v) => setEditDraft((d) => ({ ...d, totalWeight: v }))} inputId="edit-total-weight" label="总重量" />
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="edit-category-label">分类</InputLabel>
                <Select
                  labelId="edit-category-label"
                  label="分类"
                  value={editDraft.category ?? 'chondrite'}
                  onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value as SampleCategory }))}
                >
                  {SAMPLE_CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>{CATEGORY_LABELS[c]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="edit-group-label">化学群</InputLabel>
                <Select
                  labelId="edit-group-label"
                  label="化学群"
                  value={editDraft.chemicalGroup ?? 'ungrouped'}
                  onChange={(e) => setEditDraft((d) => ({ ...d, chemicalGroup: e.target.value as ChemicalGroup }))}
                >
                  {CHEMICAL_GROUPS.map((g) => (
                    <MenuItem key={g} value={g}>{CHEMICAL_GROUP_LABELS[g]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel id="edit-weathering-label">风化等级</InputLabel>
                <Select
                  labelId="edit-weathering-label"
                  label="风化等级"
                  value={editDraft.weathering ?? 'W1'}
                  onChange={(e) => setEditDraft((d) => ({ ...d, weathering: e.target.value as WeatheringGrade }))}
                >
                  {WEATHERING_GRADES.map((w) => (
                    <MenuItem key={w} value={w}>{WEATHERING_LABELS[w]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel id="edit-fallfind-label">发现/坠落</InputLabel>
                <Select
                  labelId="edit-fallfind-label"
                  label="发现/坠落"
                  value={editDraft.fallOrFind ?? 'find'}
                  onChange={(e) => setEditDraft((d) => ({ ...d, fallOrFind: e.target.value as FallOrFind }))}
                >
                  {FALL_OR_FINDS.map((f) => (
                    <MenuItem key={f} value={f}>{FALL_OR_FIND_LABELS[f]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="edit-storage-label">存放位置</InputLabel>
                <Select
                  labelId="edit-storage-label"
                  label="存放位置"
                  value={editDraft.storage ?? 'cabinet-a'}
                  onChange={(e) => setEditDraft((d) => ({ ...d, storage: e.target.value as StorageLocation }))}
                >
                  {STORAGE_LOCATIONS.map((s) => (
                    <MenuItem key={s} value={s}>{STORAGE_LABELS[s]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <TextField
              size="small"
              label="备注"
              value={editDraft.note ?? ''}
              onChange={(e) => setEditDraft((d) => ({ ...d, note: e.target.value }))}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>取消</Button>
          <Button variant="contained" onClick={submitEdit}>保存修改</Button>
        </DialogActions>
      </Dialog>

      {/* 发现记录编辑对话框 */}
      <Dialog open={findEditOpen} onClose={() => setFindEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{find ? '编辑发现地' : '补录发现地'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField
              size="small"
              label="发现地名"
              value={findDraft.placeName ?? ''}
              onChange={(e) => setFindDraft((d) => ({ ...d, placeName: e.target.value }))}
            />
            <TextField
              size="small"
              label="国家 / 地区"
              value={findDraft.region ?? ''}
              onChange={(e) => setFindDraft((d) => ({ ...d, region: e.target.value }))}
            />
            <Stack direction="row" spacing={1.5}>
              <TextField
                size="small"
                type="number"
                label="经度"
                value={findDraft.longitude ?? 0}
                onChange={(e) => setFindDraft((d) => ({ ...d, longitude: Number(e.target.value) }))}
                sx={{ width: 150 }}
              />
              <TextField
                size="small"
                type="number"
                label="纬度"
                value={findDraft.latitude ?? 0}
                onChange={(e) => setFindDraft((d) => ({ ...d, latitude: Number(e.target.value) }))}
                sx={{ width: 150 }}
              />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="find-coord-src-label">坐标来源</InputLabel>
                <Select
                  labelId="find-coord-src-label"
                  label="坐标来源"
                  value={findDraft.coordinateSource ?? 'gps'}
                  onChange={(e) => setFindDraft((d) => ({ ...d, coordinateSource: e.target.value as CoordinateSource }))}
                >
                  {COORDINATE_SOURCES.map((c) => (
                    <MenuItem key={c} value={c}>{COORDINATE_SOURCE_LABELS[c]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="find-env-label">发现环境</InputLabel>
                <Select
                  labelId="find-env-label"
                  label="发现环境"
                  value={findDraft.environment ?? 'desert'}
                  onChange={(e) => setFindDraft((d) => ({ ...d, environment: e.target.value as FindEnvironment }))}
                >
                  {FIND_ENVIRONMENTS.map((f) => (
                    <MenuItem key={f} value={f}>{FIND_ENVIRONMENT_LABELS[f]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <TextField
              size="small"
              label="发现者"
              value={findDraft.finder ?? ''}
              onChange={(e) => setFindDraft((d) => ({ ...d, finder: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFindEditOpen(false)}>取消</Button>
          <Button variant="contained" onClick={submitFindEdit}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 字段冲突裁定对话框 */}
      <ConflictDialog
        open={conflictOpen}
        conflicts={conflicts}
        onClose={() => setConflictOpen(false)}
        onResolve={conflictKind === 'sample' ? resolveSampleConflict : resolveFindConflict}
      />
    </Stack>
  );
}
