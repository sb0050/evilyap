import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import Spinner from '../components/Spinner';
import { API_BASE_URL } from '../utils/api';

type MyStoreResp = {
  success?: boolean;
  hasStore?: boolean;
  store?: {
    id?: number;
    name?: string;
    slug?: string;
    clerk_id?: string;
  } | null;
  error?: string;
};

export default function NeedADemoPage() {
  const navigate = useNavigate();
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [phoneInput, setPhoneInput] = useState<string | undefined>(undefined);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const sentRef = useRef(false);
  const tokenRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPhoneValid = Boolean(phoneInput && isValidPhoneNumber(phoneInput));

  const requestKey = useMemo(() => {
    const id = String(user?.id || '').trim();
    return id ? `needademo_sent_${id}` : '';
  }, [user?.id]);

  const sendNeedADemo = useCallback(
    async (options: {
      trigger: 'manual_recontact' | 'auto_timeout' | 'auto_exit';
      phoneE164?: string | null;
      phoneRaw?: string | null;
      silent?: boolean;
      keepalive?: boolean;
    }) => {
      if (sentRef.current) return true;
      try {
        const token = tokenRef.current || (await getToken()) || '';
        if (token && !tokenRef.current) tokenRef.current = token;
        const post = await fetch(`${API_BASE_URL}/api/stores/need-a-demo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          keepalive: Boolean(options.keepalive),
          body: JSON.stringify({
            source: 'needademo',
            trigger: options.trigger,
            phone: options.phoneE164 || null,
            phoneRaw: options.phoneRaw || null,
          }),
        });
        if (!post.ok) {
          const json = await post.json().catch(() => null as any);
          throw new Error(
            String(json?.error || "Erreur lors de l'envoi de la demande")
          );
        }
        sentRef.current = true;
        setRequested(true);
        try {
          if (requestKey) localStorage.setItem(requestKey, '1');
        } catch {}
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        return true;
      } catch (e: any) {
        if (!options.silent) {
          setError(String(e?.message || 'Erreur interne'));
        }
        return false;
      }
    },
    [getToken, requestKey]
  );

  useEffect(() => {
    if (!isLoaded) return;

    const run = async () => {
      setLoading(true);
      setError(null);
      let keepSpinner = false;

      try {
        const token = await getToken();
        tokenRef.current = String(token || '');
        const resp = await fetch(`${API_BASE_URL}/api/stores/me`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        });
        const json = (await resp
          .json()
          .catch(() => null)) as MyStoreResp | null;

        if (resp.ok && json?.hasStore) {
          keepSpinner = true;
          navigate('/dashboard', { replace: true });
          return;
        }

        const alreadySent = (() => {
          if (!requestKey) return false;
          try {
            return localStorage.getItem(requestKey) === '1';
          } catch {
            return false;
          }
        })();

        if (alreadySent) {
          sentRef.current = true;
          setRequested(true);
          setStatusMessage('Ta demande a déjà été transmise.');
        } else {
          setRequested(false);
          setStatusMessage(
            'Entre ton numéro ou attends 15 min: on t’envoie une demande de rappel automatiquement.'
          );
        }
      } catch (e: any) {
        setError(String(e?.message || 'Erreur interne'));
      } finally {
        if (!keepSpinner) setLoading(false);
      }
    };

    run();
  }, [isLoaded, getToken, navigate, requestKey]);

  useEffect(() => {
    if (loading || sentRef.current) return;
    timerRef.current = setTimeout(
      () => {
        void sendNeedADemo({
          trigger: 'auto_timeout',
          phoneE164: null,
          phoneRaw: null,
          silent: true,
        });
      },
      15 * 60 * 1000
    );
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loading, sendNeedADemo]);

  useEffect(() => {
    if (loading) return;
    const onExit = () => {
      if (sentRef.current) return;
      void sendNeedADemo({
        trigger: 'auto_exit',
        phoneE164: null,
        phoneRaw: null,
        silent: true,
        keepalive: true,
      });
    };
    window.addEventListener('beforeunload', onExit);
    window.addEventListener('pagehide', onExit);
    window.addEventListener('popstate', onExit);
    return () => {
      window.removeEventListener('beforeunload', onExit);
      window.removeEventListener('pagehide', onExit);
      window.removeEventListener('popstate', onExit);
      onExit();
    };
  }, [loading, sendNeedADemo]);

  const handleManualRequest = async () => {
    if (sending || sentRef.current) return;
    setError(null);
    const raw = String(phoneInput || '').trim();
    if (!isPhoneValid) {
      setPhoneError('Numéro invalide. Format attendu: numéro français valide.');
      return;
    }
    setPhoneError(null);
    setSending(true);
    const ok = await sendNeedADemo({
      trigger: 'manual_recontact',
      phoneE164: raw,
      phoneRaw: raw,
      silent: false,
    });
    if (ok) {
      setStatusMessage(
        'Ta demande a bien été transmise, on te recontacte vite.'
      );
    }
    setSending(false);
  };

  if (loading) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <Spinner />
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-2xl mx-auto px-4 py-10'>
        <div className='bg-white rounded-lg shadow p-6'>
          <h1 className='text-2xl font-bold text-gray-900 mb-2'>
            Demande de démo
          </h1>
          {error ? (
            <div className='text-red-600 text-sm'>{error}</div>
          ) : (
            <div className='space-y-3 text-gray-700'>
              <p>
                Merci{user?.firstName ? ` ${user.firstName}` : ''}, on va te
                recontacter très vite pour une démo.
              </p>
              <div>
                <label
                  htmlFor='needademo-phone'
                  className='block text-sm font-medium text-gray-700 mb-1'
                >
                  Numéro de téléphone (France par défaut)
                </label>
                <PhoneInput
                  id='needademo-phone'
                  value={phoneInput}
                  onChange={setPhoneInput}
                  placeholder='Entrez votre numéro'
                  defaultCountry='FR'
                  disabled={requested}
                  className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500'
                />
                {phoneError ? (
                  <p className='text-xs text-red-600 mt-1'>{phoneError}</p>
                ) : null}
              </div>
              <button
                type='button'
                onClick={handleManualRequest}
                disabled={requested || sending || !isPhoneValid}
                className='inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed'
              >
                {sending ? 'Envoi…' : 'Être recontacté'}
              </button>
              <p className='text-sm text-gray-500'>
                {requested
                  ? statusMessage || 'Ta demande a bien été transmise.'
                  : statusMessage ||
                    'Ta demande sera envoyée automatiquement dans 15 minutes ou à la sortie de cette page.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
