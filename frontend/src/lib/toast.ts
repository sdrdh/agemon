type ToastVariant = 'default' | 'destructive';

export interface ToastPayload {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

type ToastListener = (payload: ToastPayload) => void;

const listeners = new Set<ToastListener>();

export function showToast(payload: ToastPayload) {
  for (const fn of [...listeners]) fn(payload);
}

export function onToast(fn: ToastListener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
