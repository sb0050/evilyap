import React, { useState } from 'react';
import {
  useUser,
  useAuth,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  UserButton,
} from '@clerk/clerk-react';
import { apiPost } from '../../utils/api';

export default function AdminPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const role = String(user?.publicMetadata?.role || '')
    .trim()
    .toLowerCase();
  const isAdmin = role === 'admin';

  const [activeTab, setActiveTab] = useState<'prospection' | 'demo'>(
    'prospection'
  );
  const [prospectEmail, setProspectEmail] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const [demoSlug, setDemoSlug] = useState('');
  const [sendingProspect, setSendingProspect] = useState(false);
  const [sendingDemo, setSendingDemo] = useState(false);
  const [prospectResult, setProspectResult] = useState<{
    ok?: boolean;
    error?: string;
  } | null>(null);
  const [demoResult, setDemoResult] = useState<{ ok?: boolean; error?: string } | null>(
    null
  );

  const sendProspect = async () => {
    setProspectResult(null);
    if (!isAdmin) {
      setProspectResult({ error: 'Accès refusé' });
      return;
    }
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospectEmail);
    if (!valid) {
      setProspectResult({ error: 'Email invalide' });
      return;
    }
    try {
      setSendingProspect(true);
      const token = await getToken();
      const resp = await apiPost(
        '/api/admin/prospect',
        { email: prospectEmail },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Erreur envoi');
      }
      setProspectResult({ ok: true });
    } catch (e: any) {
      setProspectResult({ error: e?.message || 'Erreur envoi' });
    } finally {
      setSendingProspect(false);
    }
  };

  const sendDemo = async () => {
    setDemoResult(null);
    if (!isAdmin) {
      setDemoResult({ error: 'Accès refusé' });
      return;
    }
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(demoEmail);
    if (!valid) {
      setDemoResult({ error: 'Email invalide' });
      return;
    }
    const slug = String(demoSlug || '').trim();
    if (!slug) {
      setDemoResult({ error: 'Slug boutique invalide' });
      return;
    }
    try {
      setSendingDemo(true);
      const token = await getToken();
      const resp = await apiPost(
        '/api/admin/demo',
        { email: demoEmail, slug },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Erreur envoi');
      }
      setDemoResult({ ok: true });
    } catch (e: any) {
      setDemoResult({ error: e?.message || 'Erreur envoi' });
    } finally {
      setSendingDemo(false);
    }
  };

  return (
    <div className='min-h-screen bg-gray-50'>
      <SignedIn>
        <div className='fixed top-4 right-4 z-50'>
          <UserButton />
        </div>
        {!isAdmin ? (
          <div className='max-w-2xl mx-auto px-4 py-10'>
            <div className='bg-white rounded-lg shadow p-6'>
              <h1 className='text-2xl font-bold text-gray-900'>Accès refusé</h1>
              <p className='text-gray-600 mt-2'>
                Cette page est réservée aux administrateurs.
              </p>
            </div>
          </div>
        ) : (
        <div className='max-w-2xl mx-auto px-4 py-10'>
          <div className='mb-6'>
            <h1 className='text-2xl font-bold text-gray-900'>Admin</h1>
            <p className='text-gray-600'>Outils internes</p>
          </div>

          <div className='border-b mb-4'>
            <nav className='flex gap-6'>
              <button
                type='button'
                onClick={() => setActiveTab('prospection')}
                className={`px-2 py-2 border-b-2 font-semibold ${
                  activeTab === 'prospection'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Prospection
              </button>
              <button
                type='button'
                onClick={() => setActiveTab('demo')}
                className={`px-2 py-2 border-b-2 font-semibold ${
                  activeTab === 'demo'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Demo
              </button>
            </nav>
          </div>

          <div className='bg-white rounded-lg shadow p-6'>
            {activeTab === 'prospection' ? (
              <>
                <label className='block text-sm font-medium text-gray-700 mb-2'>
                  Email du prospect
                </label>
                <input
                  type='email'
                  value={prospectEmail}
                  onChange={e => setProspectEmail(e.target.value)}
                  placeholder='ex: vendeur@example.com'
                  className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                />
                <button
                  onClick={sendProspect}
                  disabled={
                    sendingProspect ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prospectEmail)
                  }
                  className='w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-3 font-semibold disabled:opacity-50'
                >
                  {sendingProspect ? 'Envoi…' : 'Envoyer'}
                </button>
                {prospectResult?.ok && (
                  <div className='mt-3 text-sm text-green-700'>
                    Email envoyé ✔
                  </div>
                )}
                {prospectResult?.error && (
                  <div className='mt-3 text-sm text-red-600'>
                    {prospectResult.error}
                  </div>
                )}
              </>
            ) : (
              <>
                <label className='block text-sm font-medium text-gray-700 mb-2'>
                  Email du contact à relancer
                </label>
                <input
                  type='email'
                  value={demoEmail}
                  onChange={e => setDemoEmail(e.target.value)}
                  placeholder='ex: vendeur@example.com'
                  className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                />
                <label className='block text-sm font-medium text-gray-700 mb-2'>
                  Slug de la boutique
                </label>
                <input
                  type='text'
                  value={demoSlug}
                  onChange={e => setDemoSlug(e.target.value)}
                  placeholder='ex: ma-boutique'
                  className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                />
                <button
                  onClick={sendDemo}
                  disabled={
                    sendingDemo ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(demoEmail) ||
                    !String(demoSlug || '').trim()
                  }
                  className='w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-3 font-semibold disabled:opacity-50'
                >
                  {sendingDemo ? 'Envoi…' : 'Envoyer'}
                </button>
                {demoResult?.ok && (
                  <div className='mt-3 text-sm text-green-700'>
                    Email de démo envoyé ✔
                  </div>
                )}
                {demoResult?.error && (
                  <div className='mt-3 text-sm text-red-600'>
                    {demoResult.error}
                  </div>
                )}
              </>
            )}
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
