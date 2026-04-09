import { useCallback, useEffect, useRef, useState } from 'react';
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
  const autoRequestedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);

  const sendNeedADemo = useCallback(async () => {
    try {
      const token = (await getToken()) || '';
      const contactEmail = String(
        (user as any)?.primaryEmailAddress?.emailAddress ||
          user?.emailAddresses?.[0]?.emailAddress ||
          ''
      ).trim();
      const firstName = String((user as any)?.firstName || '').trim();
      const lastName = String((user as any)?.lastName || '').trim();
      const phone = String(
        (user as any)?.primaryPhoneNumber?.phoneNumber ||
          (user as any)?.phoneNumbers?.[0]?.phoneNumber ||
          ''
      ).trim();

      const post = await fetch(`${API_BASE_URL}/api/stores/need-a-demo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          source: 'needademo',
          contactEmail: contactEmail || null,
          firstName: firstName || null,
          lastName: lastName || null,
          phone: phone || null,
          phoneRaw: phone || null,
        }),
      });
      if (!post.ok) {
        const json = await post.json().catch(() => null as any);
        throw new Error(String(json?.error || "Erreur lors de l'envoi"));
      }
      setRequested(true);
      return true;
    } catch (e: any) {
      setError(String(e?.message || 'Erreur interne'));
      return false;
    }
  }, [getToken, user]);

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
      } catch (e: any) {
        setError(String(e?.message || 'Erreur interne'));
      } finally {
        if (!keepSpinner) setLoading(false);
      }
    };

    run();
  }, [isLoaded, getToken, navigate]);

  useEffect(() => {
    if (!isLoaded || loading || requested || sending) return;
    if (autoRequestedRef.current) return;
    autoRequestedRef.current = true;
    const run = async () => {
      setSending(true);
      await sendNeedADemo();
      setSending(false);
    };
    run();
  }, [isLoaded, loading, requested, sending, sendNeedADemo]);

  if (loading || sending) {
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
            Demande envoyée avec succès ✅
          </h1>
          {error ? (
            <div className='text-red-600 text-sm'>{error}</div>
          ) : (
            <div className='space-y-3 text-gray-700'>
              <p>Merci ! Ta demande de démo a bien été prise en compte.</p>
              <p className='text-sm text-gray-500'>
                On te recontacte très rapidement pour te montrer comment PayLive
                peut t’aider à simplifier tes ventes en live.
              </p>
              <button
                type='button'
                onClick={() => {
                  window.location.href = 'https://paylive.cc';
                }}
                className='inline-flex items-center px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50'
              >
                Retour vers l’accueil
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
