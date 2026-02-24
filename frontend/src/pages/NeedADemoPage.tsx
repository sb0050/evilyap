import { useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
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

  const requestKey = useMemo(() => {
    const id = String(user?.id || '').trim();
    return id ? `needademo_sent_${id}` : '';
  }, [user?.id]);

  useEffect(() => {
    if (!isLoaded) return;

    const run = async () => {
      setLoading(true);
      setError(null);
      let keepSpinner = false;

      try {
        const token = await getToken();
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

        if (!alreadySent) {
          const post = await fetch(`${API_BASE_URL}/api/stores/need-a-demo`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: token ? `Bearer ${token}` : '',
            },
            body: JSON.stringify({ source: 'needademo' }),
          });
          if (post.ok) {
            try {
              if (requestKey) localStorage.setItem(requestKey, '1');
            } catch {}
          }
        }

        setRequested(true);
      } catch (e: any) {
        setError(String(e?.message || 'Erreur interne'));
      } finally {
        if (!keepSpinner) setLoading(false);
      }
    };

    run();
  }, [isLoaded, getToken, navigate, requestKey]);

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
            <div className='space-y-2 text-gray-700'>
              <p>
                Merci{user?.firstName ? ` ${user.firstName}` : ''}, on va te
                recontacter très vite pour une démo.
              </p>
              <p className='text-sm text-gray-500'>
                {requested
                  ? 'Ta demande a bien été transmise.'
                  : 'Ta demande est en cours de traitement.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
