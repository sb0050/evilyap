import { useEffect, useMemo, useState } from 'react';

type TikTokUsernameModalProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  error: string | null;
  onConfirm: (username: string) => Promise<void> | void;
};

const sanitizeTikTokUsername = (value: string): string => {
  return String(value || '').trim().replace(/^@+/, '').replace(/\s+/g, '');
};

export default function TikTokUsernameModal({
  isOpen,
  isSubmitting,
  error,
  onConfirm,
}: TikTokUsernameModalProps) {
  const [usernameInput, setUsernameInput] = useState('');

  const normalizedUsername = useMemo(
    () => sanitizeTikTokUsername(usernameInput),
    [usernameInput]
  );

  useEffect(() => {
    if (!isOpen) {
      setUsernameInput('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // Cette modale est bloquante : on neutralise la touche Echap pour
    // garantir que l'utilisateur renseigne son username TikTok avant checkout.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
    };

    const listenerOptions: AddEventListenerOptions = { capture: true };
    window.addEventListener('keydown', handleEscape, listenerOptions);
    return () => {
      window.removeEventListener('keydown', handleEscape, listenerOptions);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-[100]'>
      <div className='absolute inset-0 bg-gray-900/60' />
      <div className='relative flex min-h-screen items-center justify-center p-4'>
        <div className='w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl'>
          <h2 className='text-xl font-semibold text-gray-900'>Renseigne ton @TikTok</h2>
          <p className='mt-2 text-sm text-gray-600'>
            Nous avons besoin de ton identifiant TikTok pour retrouver ton panier du live.
          </p>

          <label
            htmlFor='tiktok-username-input'
            className='mt-4 block text-sm font-medium text-gray-700'
          >
            Nom d&apos;utilisateur TikTok
          </label>
          <div className='mt-1 flex items-center rounded-md border border-gray-300 px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500'>
            <span className='mr-1 text-gray-500'>@</span>
            <input
              id='tiktok-username-input'
              type='text'
              autoFocus
              value={usernameInput}
              onChange={e => setUsernameInput(sanitizeTikTokUsername(e.target.value))}
              placeholder='@mon_username_tiktok'
              className='w-full border-none p-0 text-sm text-gray-900 outline-none'
            />
          </div>

          <div className='mt-4 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700'>
            ⚠️ Ce nom d&apos;utilisateur sera associé définitivement à ton compte. Il ne pourra
            pas être modifié. Assure-toi qu&apos;il correspond exactement à ton @TikTok.
          </div>

          {error ? (
            <div className='mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
              {error}
            </div>
          ) : null}

          <div className='mt-5 flex justify-end'>
            <button
              type='button'
              disabled={!normalizedUsername || isSubmitting}
              onClick={() => onConfirm(normalizedUsername)}
              className='inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
            >
              {isSubmitting ? 'Confirmation...' : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
