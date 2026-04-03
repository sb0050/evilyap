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
      setContactResult({ error: 'Accès refusé' });
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
      setRdvResult({ error: 'Accès refusé' });
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
                  RDV Démo
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
                  Démo
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
                    Prénom
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
                      Mail qui sera envoyé
                    </div>
                    <div className='text-sm text-gray-800'>
                      Objet:{' '}
                      {`${String(contactName || '').trim() || '[Prénom]'}, Vous gérez encore vos commandes de vos live à la main ? 🤔`}
                    </div>
                    <pre className='mt-2 whitespace-pre-wrap text-sm text-gray-700 font-sans'>
                      {`Bonjour ${String(contactName || '').trim() || '[Prénom]'},

Faire de la vente en live, ça devrait être simple : trouver les meilleurs articles pour vos clientes, animer votre communauté, et vendre. Mais dans les faits, vous passez la majorité de votre temps sur la logistique, l'organisation du live, et tout ce qui vient après, au lieu de vous concentrer sur ce qui fait vraiment la différence.

Vous envoyez vos récapitulatifs de commande à la main. Vous relancez les paniers impayés un par un. Vous créez chaque colis manuellement. Vous répondez 10 fois par jour à "Mon colis a-t-il été envoyé ?".

Sans parler des liens de paiement envoyés à la main, des ventes notées dans un tableau Excel, des factures rédigées une par une, et d'un suivi client qui n'existe tout simplement pas.

Ce n'est pas une façon de faire grandir sa boutique. C'est une façon de s'épuiser.

C'est exactement ce problème qu'on a résolu avec PayLive.

PayLive est une solution tout-en-un pensée pour les vendeuses en live :
✅ Récapitulatifs de commande envoyés automatiquement à vos clientes
✅ Relances des paniers impayés sans aucune intervention de votre part
✅ Création de colis automatisée (Mondial Relay, Colissimo…)
✅ Liens de paiement générés et envoyés en un clic
✅ Suivi de vos clientes, factures et statistiques au même endroit
✅ Frais sur vos paiements réduits, bien en dessous de PayPal, SumUp ou Lydia

Vos clientes sont informées à chaque étape. Vous, vous faites du live.

Je serais ravie de vous montrer concrètement comment ça fonctionne, en 10 minutes chrono.

👉 Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?
👉 Quel est votre numéro de téléphone pour qu'on puisse échanger directement ?

À très vite,`}
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
                    {sendingContact ? 'Envoi…' : 'Envoyer'}
                  </button>
                  {contactResult?.ok && (
                    <div className='mt-3 text-sm text-green-700'>
                      Email envoyé ✔
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
                    Prénom
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
                      Mail qui sera envoyé
                    </div>
                    <div className='text-sm text-gray-800'>
                      Objet:{' '}
                      {`${String(rdvName || '').trim() || '[Prénom]'}, on organise une démo ? 🚀`}
                    </div>
                    <pre className='mt-2 whitespace-pre-wrap text-sm text-gray-700 font-sans'>
                      {`Bonjour ${String(rdvName || '').trim() || '[Prénom]'},

Pour aller plus loin, je vous propose une démo rapide (10 min) pour vous montrer PayLive en action — directement sur vos cas d’usage.

Deux petites choses pour qu’on cale ça :
• Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?
• Quel est votre numéro de téléphone pour qu’on reste en contact facilement ?

Hâte de vous faire découvrir la solution !

À très vite,`}
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
                    {sendingRdv ? 'Envoi…' : 'Envoyer'}
                  </button>
                  {rdvResult?.ok && (
                    <div className='mt-3 text-sm text-green-700'>
                      Email envoyé ✔
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
                    Prénom
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
                      Mail qui sera envoyé
                    </div>
                    <div className='text-sm text-gray-800'>
                      Objet:{' '}
                      {`${String(demoName || '').trim() || '[Prénom]'}, suite à notre échange, retrouvez ci-dessous le tutoriel et le lien vers votre boutique.👇`}
                    </div>
                    <pre className='mt-2 whitespace-pre-wrap text-sm text-gray-700 font-sans'>
                      {`Bonjour ${String(demoName || '').trim() || '[Prénom]'},

Comme promis, voici le lien vers notre tutoriel
👉 Cliquez ici pour accéder au tutoriel: paylive.cc/demo-vendeur

J'ai également créé votre boutique personnalisée avec l'ensemble de vos articles, vous pouvez y accéder ici :
🛍️ Lien vers votre boutique: paylive.cc/s/${String(demoSlug || '').trim() || '[slug]'}

Et voici le lien à partager directement à vos clientes lors de vos prochains lives afin qu'elles puissent constituer leurs paniers et procéder au paiement :
📲 Lien à partager en live: paylive.cc/c/${String(demoSlug || '').trim() || '[slug]'}

N’hésitez pas à me contacter si vous avez des questions !

À très vite,
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
