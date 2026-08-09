/**
 * Toast slice — ephemeral user-facing message state
 */
import type { StateCreator } from 'zustand';
import type { AppState } from './useAppStore';

export interface ToastSlice {
  toast: { visible: boolean; message: string; type: 'success' | 'error' | 'info' };
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  dismissToast: () => void;
}

const initialToast = { visible: false, message: '', type: 'success' as const };

/** 报错要留够读完和点复制的时间 */
const TOAST_DURATION = { error: 15_000, other: 2_500 };

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export const createToastSlice: StateCreator<AppState, [], [], ToastSlice> = (set) => ({
  toast: { ...initialToast },
  showToast: (message, type = 'success') => {
    // 上一条的定时器不清掉会把这条提前关掉
    clearTimeout(hideTimer);
    set({ toast: { visible: true, message, type } });
    hideTimer = setTimeout(
      () => set((state) => ({ toast: { ...state.toast, visible: false } })),
      type === 'error' ? TOAST_DURATION.error : TOAST_DURATION.other,
    );
  },
  dismissToast: () => {
    clearTimeout(hideTimer);
    set({ toast: { visible: false, message: '', type: 'success' } });
  },
});
