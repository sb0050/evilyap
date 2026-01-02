import React, { useState } from 'react';
import {
  useUser,
  useAuth,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  UserButton,
} from '@clerk/clerk-react';
import { apiPost } from '../utils/api';

export default function AdminPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const role = (user?.publicMetadata as any)?.role;

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(
    null
  );

  const sendProspect = async () => {
    setResult(null);
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid) {
      setResult({ error: 'Email invalide' });
      return;
    }
    try {
      setSending(true);
      const token = await getToken();
      const resp = await apiPost(
        '/api/admin/prospect',
        { email },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Erreur envoi');
      }
      setResult({ ok: true });
    } catch (e: any) {
      setResult({ error: e?.message || 'Erreur envoi' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className='min-h-screen bg-gray-50'>
      <SignedIn>
        <div className='fixed top-4 right-4 z-50'>
          <UserButton />
        </div>
        {role === 'admin' ? (
          <div className='max-w-2xl mx-auto px-4 py-10'>
            <div className='mb-6'>
              <h1 className='text-2xl font-bold text-gray-900'>Admin</h1>
              <p className='text-gray-600'>Outils internes</p>
            </div>

            <div className='border-b mb-4'>
              <nav className='flex gap-6'>
                <span className='px-2 py-2 border-b-2 border-indigo-600 text-indigo-600 font-semibold'>
                  Prospection
                </span>
              </nav>
            </div>

            <div className='bg-white rounded-lg shadow p-6'>
              <label className='block text-sm font-medium text-gray-700 mb-2'>
                Email du prospect
              </label>
              <input
                type='email'
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder='ex: vendeur@example.com'
                className='w-full border border-gray-300 rounded-lg p-3 mb-4'
              />
              <button
                onClick={sendProspect}
                disabled={sending || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                className='w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-3 font-semibold disabled:opacity-50'
              >
                {sending ? 'Envoi…' : 'Envoyer'}
              </button>
              {result?.ok && (
                <div className='mt-3 text-sm text-green-700'>
                  Email envoyé ✔
                </div>
              )}
              {result?.error && (
                <div className='mt-3 text-sm text-red-600'>{result.error}</div>
              )}
            </div>
          </div>
        ) : (
          <div className='max-w-xl mx-auto px-4 py-20 text-center'>
            <div className='text-2xl font-bold text-gray-900'>Accès refusé</div>
            <div className='text-gray-600 mt-2'>
              Cette page est réservée aux administrateurs.
            </div>
          </div>
        )}
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </div>
  );
}