import { useState } from 'react';
import type { ToastType } from '../components/Toast';

export type ToastState = {
  message: string;
  type: ToastType;
  visible?: boolean;
} | null;

export const useToast = () => {
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = (message: string, type: ToastType = 'error') => {
    setToast({ message, type, visible: true });
    setTimeout(() => {
      setToast(prev => (prev ? { ...prev, visible: false } : prev));
      setTimeout(() => setToast(null), 300);
    }, 4000);
  };

  const hideToast = () => {
    setToast(prev => (prev ? { ...prev, visible: false } : prev));
    setTimeout(() => setToast(null), 300);
  };

  return { toast, showToast, hideToast, setToast };
};
