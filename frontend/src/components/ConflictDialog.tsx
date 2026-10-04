import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { FieldConflict } from '../utils/revision';

interface ConflictDialogProps {
  open: boolean;
  conflicts: FieldConflict[];
  title?: string;
  /** 裁定完成：返回按用户选择合并后的字段值 */
  onResolve: (resolved: Record<string, unknown>) => void;
  onClose: () => void;
}

function displayValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '（空）';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * 字段冲突裁定对话框：版本落后时列出「你的输入」与「当前档案值」，
 * 用户逐字段选择保留哪一方，裁定完成后才写入新版本。
 */
export default function ConflictDialog({
  open,
  conflicts,
  title = '档案已被其他标签页更新',
  onResolve,
  onClose,
}: ConflictDialogProps) {
  // 每个字段的选择：'mine' 保留本次输入 / 'current' 采用当前档案值
  const [choices, setChoices] = useState<Record<string, 'mine' | 'current'>>({});

  useEffect(() => {
    if (open) {
      const init: Record<string, 'mine' | 'current'> = {};
      conflicts.forEach((c) => {
        init[c.field] = 'mine';
      });
      setChoices(init);
    }
  }, [open, conflicts]);

  const allMine = useMemo(
    () => conflicts.every((c) => choices[c.field] === 'mine'),
    [conflicts, choices],
  );
  const allCurrent = useMemo(
    () => conflicts.every((c) => choices[c.field] === 'current'),
    [conflicts, choices],
  );

  const setAll = (v: 'mine' | 'current') => {
    const next: Record<string, 'mine' | 'current'> = {};
    conflicts.forEach((c) => {
      next[c.field] = v;
    });
    setChoices(next);
  };

  const handleResolve = () => {
    const resolved: Record<string, unknown> = {};
    conflicts.forEach((c) => {
      resolved[c.field] = choices[c.field] === 'mine' ? c.yours : c.current;
    });
    onResolve(resolved);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <WarningAmberIcon color="warning" />
          <Typography variant="h6">{title}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            你打开的是较早的修订版本，期间有其他标签页保存了修改。以下字段存在冲突，
            请逐字段裁定保留哪一方；未冲突的字段将按你的输入一并写入新版本。
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label="全部保留我的输入"
              color={allMine ? 'primary' : 'default'}
              variant={allMine ? 'filled' : 'outlined'}
              onClick={() => setAll('mine')}
            />
            <Chip
              size="small"
              label="全部采用当前档案值"
              color={allCurrent ? 'secondary' : 'default'}
              variant={allCurrent ? 'filled' : 'outlined'}
              onClick={() => setAll('current')}
            />
          </Stack>
          <Divider />
          {conflicts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              你的修改与当前档案值没有重叠字段，可直接写入。
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {conflicts.map((c) => (
                <Stack
                  key={c.field}
                  spacing={0.75}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    p: 1.25,
                  }}
                >
                  <Typography variant="subtitle2" fontWeight={700}>
                    {c.label}
                  </Typography>
                  <RadioGroup
                    value={choices[c.field] ?? 'mine'}
                    onChange={(e) =>
                      setChoices((prev) => ({
                        ...prev,
                        [c.field]: e.target.value as 'mine' | 'current',
                      }))
                    }
                  >
                    <FormControlLabel
                      value="mine"
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="body2">
                          保留我的输入：<strong>{displayValue(c.yours)}</strong>
                        </Typography>
                      }
                    />
                    <FormControlLabel
                      value="current"
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="body2">
                          采用当前档案值：{displayValue(c.current)}
                        </Typography>
                      }
                    />
                  </RadioGroup>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleResolve}>
          裁定完成并写入新版本
        </Button>
      </DialogActions>
    </Dialog>
  );
}
