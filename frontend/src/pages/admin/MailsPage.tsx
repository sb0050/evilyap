import React, { useState } from 'react';
import {
  useUser,
  useAuth,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  UserButton,
} from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { apiPost } from '../../utils/api';

export default function MailsPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const role = String(user?.publicMetadata?.role || '')
    .trim()
    .toLowerCase();
  const isAdmin = role === 'admin';

  const [activeTab, setActiveTab] = useState<'contact' | 'rdv' | 'demo'>(
    'contact'
  );
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [rdvEmail, setRdvEmail] = useState('');
  const [rdvName, setRdvName] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const [demoName, setDemoName] = useState('');
  const [demoSlug, setDemoSlug] = useState('');
  const [sendingContact, setSendingContact] = useState(false);
  const [sendingRdv, setSendingRdv] = useState(false);
  const [sendingDemo, setSendingDemo] = useState(false);
  const [contactResult, setContactResult] = useState<{
    ok?: boolean;
    error?: string;
  } | null>(null);
  const [rdvResult, setRdvResult] = useState<{
    ok?: boolean;
    error?: string;
  } | null>(null);
  const [demoResult, setDemoResult] = useState<{
    ok?: boolean;
    error?: string;
  } | null>(null);

  const sendContact = async () => {
    setContactResult(null);
    if (!isAdmin) {
      setContactResult({ error: 'Accأ¨s refusأ©' });
      return;
    }
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);
    if (!valid) {
      setContactResult({ error: 'Email invalide' });
      return;
    }
    const name = String(contactName || '').trim();
    if (!name) {
      setContactResult({ error: 'Nom invalide' });
      return;
    }
    try {
      setSendingContact(true);
      const token = await getToken();
      const resp = await apiPost(
        '/api/admin/prospect',
        { email: contactEmail, name },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Erreur envoi');
      }
      setContactResult({ ok: true });
    } catch (e: any) {
      setContactResult({ error: e?.message || 'Erreur envoi' });
    } finally {
      setSendingContact(false);
    }
  };

  const sendRdv = async () => {
    setRdvResult(null);
    if (!isAdmin) {
      setRdvResult({ error: 'Accأ¨s refusأ©' });
      return;
    }
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rdvEmail);
    if (!valid) {
      setRdvResult({ error: 'Email invalide' });
      return;
    }
    const name = String(rdvName || '').trim();
    if (!name) {
      setRdvResult({ error: 'Nom invalide' });
      return;
    }
    try {
      setSendingRdv(true);
      const token = await getToken();
      const resp = await apiPost(
        '/api/admin/rdv-demo',
        { email: rdvEmail, name },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Erreur envoi');
      }
      setRdvResult({ ok: true });
    } catch (e: any) {
      setRdvResult({ error: e?.message || 'Erreur envoi' });
    } finally {
      setSendingRdv(false);
    }
  };

  const sendDemo = async () => {
    setDemoResult(null);
    if (!isAdmin) {
      setDemoResult({ error: 'Accأ¨s refusأ©' });
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
    const name = String(demoName || '').trim();
    if (!name) {
      setDemoResult({ error: 'Nom invalide' });
      return;
    }
    try {
      setSendingDemo(true);
      const token = await getToken();
      const resp = await apiPost(
        '/api/admin/demo',
        { email: demoEmail, slug, name },
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
              <h1 className='text-2xl font-bold text-gray-900'>Accأ¨s refusأ©</h1>
              <p className='text-gray-600 mt-2'>
                Cette page est rأ©servأ©e aux administrateurs.
              </p>
            </div>
          </div>
        ) : (
          <div className='max-w-2xl mx-auto px-4 py-10'>
            <div className='mb-6 flex items-start justify-between gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>Admin</h1>
                <p className='text-gray-600'>Outils internes</p>
              </div>
              <Link
                to='/admin'
                className='inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100'
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  className='h-4 w-4'
                  aria-hidden='true'
                >
                  <path d='M15 18l-6-6 6-6' />
                </svg>
                Retour
              </Link>
            </div>

            <div className='border-b mb-4'>
              <nav className='flex gap-6'>
                <button
                  type='button'
                  onClick={() => setActiveTab('contact')}
                  className={`px-2 py-2 border-b-2 font-semibold ${
                    activeTab === 'contact'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  1er contact
                </button>
                <button
                  type='button'
                  onClick={() => setActiveTab('rdv')}
                  className={`px-2 py-2 border-b-2 font-semibold ${
                    activeTab === 'rdv'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  RDV Dأ©mo
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
                  Dأ©mo
                </button>
              </nav>
            </div>

            <div className='bg-white rounded-lg shadow p-6'>
              {activeTab === 'contact' ? (
                <>
                  <label className='block text-sm font-medium text-gray-700 mb-2'>
                    Email du prospect
                  </label>
                  <input
                    type='email'
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder='ex: vendeur@example.com'
                    className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                  />
                  <label className='block text-sm font-medium text-gray-700 mb-2'>
                    Prأ©nom
                  </label>
                  <input
                    type='text'
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    placeholder='ex: Muriel'
                    className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                  />
                  <div className='mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4'>
                    <div className='text-sm font-semibold text-gray-900 mb-2'>
                      Mail qui sera envoyأ©
                    </div>
                    <div className='text-sm text-gray-800'>
                      Objet:{' '}
                      {`${String(contactName || '').trim() || '[Prأ©nom]'}, marre des paniers abandonnأ©s aprأ¨s tes ventes en live sur Facebook ?`}
                    </div>
                    <pre className='mt-2 whitespace-pre-wrap text-sm text-gray-700 font-sans'>
                      {`Bonjour ${String(contactName || '').trim() || '[Prأ©nom]'},

Est-ce que tu rencontres ce genre de problأ¨mes pendant ou aprأ¨s tes ventes en live sur Facebook ?

â‌Œ commandes أ  noter
â‌Œ paiements أ  vأ©rifier
â‌Œ colis أ  crأ©er
â‌Œ clientes أ  relancer
â‌Œ rأ©cap + lien de paiement أ  envoyer manuellement

Au final, tu passes plus de temps أ  gأ©rer quâ€™أ  vendre.

Câ€™est exactement pour أ§a quâ€™on a crأ©أ© PayLive.

ًں‘‰ PayLive automatise tout ce qui te fait perdre du temps :
ًں’³ Notification instantanأ© au paiement
ًں“¦ Livraison & bordereaux intأ©grأ©s
ًں“‹ Envoi automatique des paniers
ًں“ٹ Suivi de tes ventes et de ton stock

Rأ©sultat : tu te concentres sur tes livesâ€¦ et PayLive sâ€™occupe du reste.

ًں‘‡ Clique sur le bouton ci-dessous pour voir comment أ§a marche ًں‘‡
[Bouton Voir comment أ§a marche â†’ https://paylive.cc/needademo]
[Image ad_paylive.png cliquable â†’ https://paylive.cc/needademo]

أ€ trأ¨s vite,`}
                    </pre>
                  </div>
                  <button
                    onClick={sendContact}
                    disabled={
                      sendingContact ||
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) ||
                      !String(contactName || '').trim()
                    }
                    className='w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-3 font-semibold disabled:opacity-50'
                  >
                    {sendingContact ? 'Envoiâ€¦' : 'Envoyer'}
                  </button>
                  {contactResult?.ok && (
                    <div className='mt-3 text-sm text-green-700'>
                      Email envoyأ© âœ”
                    </div>
                  )}
                  {contactResult?.error && (
                    <div className='mt-3 text-sm text-red-600'>
                      {contactResult.error}
                    </div>
                  )}
                </>
              ) : activeTab === 'rdv' ? (
                <>
                  <label className='block text-sm font-medium text-gray-700 mb-2'>
                    Email du prospect
                  </label>
                  <input
                    type='email'
                    value={rdvEmail}
                    onChange={e => setRdvEmail(e.target.value)}
                    placeholder='ex: vendeur@example.com'
                    className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                  />
                  <label className='block text-sm font-medium text-gray-700 mb-2'>
                    Prأ©nom
                  </label>
                  <input
                    type='text'
                    value={rdvName}
                    onChange={e => setRdvName(e.target.value)}
                    placeholder='ex: Muriel'
                    className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                  />
                  <div className='mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4'>
                    <div className='text-sm font-semibold text-gray-900 mb-2'>
                      Mail qui sera envoyأ©
                    </div>
                    <div className='text-sm text-gray-800'>
                      Objet:{' '}
                      {`${String(rdvName || '').trim() || '[Prأ©nom]'}, on organise une dأ©mo ? ًںڑ€`}
                    </div>
                    <pre className='mt-2 whitespace-pre-wrap text-sm text-gray-700 font-sans'>
                      {`Bonjour ${String(rdvName || '').trim() || '[Prأ©nom]'},

Pour aller plus loin, je vous propose une dأ©mo rapide (10 min) pour vous montrer PayLive en action â€” directement sur vos cas dâ€™usage.

Deux petites choses pour quâ€™on cale أ§a :
â€¢ Quelles sont vos disponibilitأ©s cette semaine ou la semaine prochaine ?
â€¢ Quel est votre numأ©ro de tأ©lأ©phone pour quâ€™on reste en contact facilement ?

Hأ¢te de vous faire dأ©couvrir la solution !

أ€ trأ¨s vite,`}
                    </pre>
                  </div>
                  <button
                    onClick={sendRdv}
                    disabled={
                      sendingRdv ||
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rdvEmail) ||
                      !String(rdvName || '').trim()
                    }
                    className='w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-3 font-semibold disabled:opacity-50'
                  >
                    {sendingRdv ? 'Envoiâ€¦' : 'Envoyer'}
                  </button>
                  {rdvResult?.ok && (
                    <div className='mt-3 text-sm text-green-700'>
                      Email envoyأ© âœ”
                    </div>
                  )}
                  {rdvResult?.error && (
                    <div className='mt-3 text-sm text-red-600'>
                      {rdvResult.error}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className='block text-sm font-medium text-gray-700 mb-2'>
                    Email du contact أ  relancer
                  </label>
                  <input
                    type='email'
                    value={demoEmail}
                    onChange={e => setDemoEmail(e.target.value)}
                    placeholder='ex: vendeur@example.com'
                    className='w-full border border-gray-300 rounded-lg p-3 mb-4'
                  />
                  <label className='block text-sm font-medium text-gray-700 mb-2'>
                    Prأ©nom
                  </label>
                  <input
                    type='text'
                    value={demoName}
                    onChange={e => setDemoName(e.target.value)}
                    placeholder='ex: Muriel'
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
                  <div className='mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4'>
                    <div className='text-sm font-semibold text-gray-900 mb-2'>
                      Mail qui sera envoyأ©
                    </div>
                    <div className='text-sm text-gray-800'>
                      Objet:{' '}
                      {`${String(demoName || '').trim() || '[Prأ©nom]'}, suite أ  notre أ©change, retrouvez ci-dessous le tutoriel et le lien vers votre boutique.ًں‘‡`}
                    </div>
                    <pre className='mt-2 whitespace-pre-wrap text-sm text-gray-700 font-sans'>
                      {`Bonjour ${String(demoName || '').trim() || '[Prأ©nom]'},

Comme promis, voici le lien vers notre tutoriel
ًں‘‰ Cliquez ici pour accأ©der au tutoriel: paylive.cc/demo-vendeur

J'ai أ©galement crأ©أ© votre boutique personnalisأ©e avec l'ensemble de vos articles, vous pouvez y accأ©der ici :
ًں›چï¸ڈ Lien vers votre boutique: paylive.cc/s/${String(demoSlug || '').trim() || '[slug]'}

Et voici le lien أ  partager directement أ  vos clientes lors de vos prochains lives afin qu'elles puissent constituer leurs paniers et procأ©der au paiement :
ًں“² Lien أ  partager en live: paylive.cc/c/${String(demoSlug || '').trim() || '[slug]'}

Nâ€™hأ©sitez pas أ  me contacter si vous avez des questions !

أ€ trأ¨s vite,
PayLive.cc
`}
                    </pre>
                  </div>
                  <button
                    onClick={sendDemo}
                    disabled={
                      sendingDemo ||
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(demoEmail) ||
                      !String(demoName || '').trim() ||
                      !String(demoSlug || '').trim()
                    }
                    className='w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-3 font-semibold disabled:opacity-50'
                  >
                    {sendingDemo ? 'Envoiâ€¦' : 'Envoyer'}
                  </button>
                  {demoResult?.ok && (
                    <div className='mt-3 text-sm text-green-700'>
                      Email de dأ©mo envoyأ© âœ”
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
