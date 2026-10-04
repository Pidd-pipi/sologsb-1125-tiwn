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
  Radio,
  Stack,
  Typography,
} from '@mui/material';
import {
  conflictKey,
  type FieldConflict,
  type MergedField,
  type ResolutionMap,
} from '../../utils/revision';

interface ConflictDialogProps {
  open: boolean;
  conflicts: FieldConflict[];
  merged: MergedField[];
  /** 对方领先的修订幅度说明 */
  revisionNote?: string;
  onCancel: () => void;
  onConfirm: (resolutions: ResolutionMap) => void;
}

/**
 * 版本落后时的字段冲突裁定框：
 *  - 列出双方同时修改且取值不同的字段，逐项二选一（默认保留本次输入）
 *  - 仅对方修改的字段自动合并，仅作提示
 *  - 裁定完成后由调用方携带 resolutions 再次提交，写入新版本
 */
export default function ConflictResolutionDialog({
  open,
  conflicts,
  merged,
  revisionNote,
  onCancel,
  onConfirm,
}: ConflictDialogProps) {
  const [picked, setPicked] = useState<ResolutionMap>({});

  useEffect(() => {
    if (open) {
      const initial: ResolutionMap = {};
      conflicts.forEach((c) => {
        initial[conflictKey(c)] = 'mine'; // 保留本次输入
      });
      setPicked(initial);
    }
  }, [open, conflicts]);

  const groups = useMemo(() => {
    const map = new Map<string, { entity: string; label: string; items: FieldConflict[] }>();
    for (const c of conflicts) {
      const key = `${c.entity}:${c.entityId}`;
      const entry = map.get(key) ?? { entity: c.entity, label: c.entityLabel, items: [] };
      entry.items.push(c);
      map.set(key, entry);
    }
    const rank: Record<string, number> = { sample: 0, find: 1, section: 2, analysis: 3 };
    return Array.from(map.values()).sort((a, b) => rank[a.entity] - rank[b.entity]);
  }, [conflicts]);

  const theirsCount = conflicts.filter((c) => picked[conflictKey(c)] === 'theirs').length;

  return (
    <Dialog open={open} maxWidth="sm" fullWidth>
      <DialogTitle>版本落后 · 字段冲突裁定</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="warning">
            另一位编辑者已先保存，档案簇修订号已前进{revisionNote ? `（${revisionNote}）` : ''}。
            下列字段双方都做了修改，请逐项裁定；仅对方修改的字段会自动合并。本次输入已默认保留。
          </Alert>

          {groups.map((g) => (
            <Box key={`${g.entity}:${g.label}`}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                {g.label}
              </Typography>
              <Stack spacing={1}>
                {g.items.map((c) => {
                  const key = conflictKey(c);
                  const choice = picked[key] ?? 'mine';
                  const pick = (v: 'mine' | 'theirs') =>
                    setPicked((p) => ({ ...p, [key]: v }));
                  return (
                    <Box
                      key={key}
                      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.25 }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                        <Typography variant="subtitle2">{c.label}</Typography>
                        <Chip size="small" variant="outlined" label={`原版本值 ${c.base}`} />
                      </Stack>
                      <Stack
                        direction="row"
                        onClick={() => pick('mine')}
                        sx={{ cursor: 'pointer', alignItems: 'flex-start' }}
                      >
                        <Radio size="small" checked={choice === 'mine'} tabIndex={-1} sx={{ p: 0.5 }} />
                        <Typography variant="body2" fontWeight={choice === 'mine' ? 700 : 400}>
                          保留本次输入：{c.mine}
                        </Typography>
                      </Stack>
                      <Stack
                        direction="row"
                        onClick={() => pick('theirs')}
                        sx={{ cursor: 'pointer', alignItems: 'flex-start' }}
                      >
                        <Radio size="small" checked={choice === 'theirs'} tabIndex={-1} sx={{ p: 0.5 }} />
                        <Typography variant="body2" fontWeight={choice === 'theirs' ? 700 : 400}>
                          采用对方新版本：{c.theirs}
                        </Typography>
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          ))}

          {merged.length ? (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  自动合并（仅对方修改，本方未动，{merged.length} 项）
                </Typography>
                <Stack spacing={0.25}>
                  {merged.map((m, i) => (
                    <Typography key={`${m.entity}-${m.field}-${i}`} variant="body2" color="text.secondary">
                      {m.entityLabel} · {m.label} → {m.theirs}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
          保留本次输入 {conflicts.length - theirsCount} 项 · 采用对方 {theirsCount} 项
        </Typography>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="contained" onClick={() => onConfirm(picked)}>
          按裁定写入新版本
        </Button>
      </DialogActions>
    </Dialog>
  );
}
