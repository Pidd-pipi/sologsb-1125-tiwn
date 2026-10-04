import { useEffect } from 'react';
import { useSampleStore } from '../stores/sampleStore';

/**
 * 窗口重新获得焦点时静默重载本地档案，
 * 以同步其他标签页对 IndexedDB 的写入（跨标签页修订号变更）。
 */
export function useReloadOnFocus() {
  const silentReload = useSampleStore((s) => s.silentReload);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void silentReload();
      }
    };
    const onFocus = () => {
      void silentReload();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [silentReload]);
}
