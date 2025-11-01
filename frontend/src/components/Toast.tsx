import React, { useEffect, useState } from 'react';

export type ToastType = 'error' | 'info' | 'success';

export const Toast: React.FC<{
  message: string;
  type?: ToastType;
  visible?: boolean;
}> = ({ message, type = 'error', visible = true }) => {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (visible === false) {
      setEntered(false);
    }
  }, [visible]);

  const base =
    'fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded shadow-lg text-sm transition-all duration-300 ease-out text-center';
  const color =
    type === 'success'
      ? 'bg-green-600 text-white'
      : type === 'info'
        ? 'bg-blue-600 text-white'
        : 'bg-red-600 text-white';
  const anim = entered
    ? 'opacity-100 -translate-y-0'
    : 'opacity-0 -translate-y-2';

  return (
    <div
      className={`${base} ${color} ${anim}`}
      role='alert'
      aria-live='assertive'
    >
      {message}
    </div>
  );
};
