import { useState } from 'react';
import type { ToastType } from '../components/Toast';

export type ToastState = { message: string; type: ToastType } | null;

export const useToast = () => {
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = (
    message: string,
    type: ToastType = 'error'
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const hideToast = () => setToast(null);

  return { toast, showToast, hideToast, setToast };
};