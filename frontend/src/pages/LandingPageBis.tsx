import React, { useState } from 'react';
import { FaFacebook, FaTiktok } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown } from 'lucide-react';

const LandingPageBis = () => {
  const navigate = useNavigate();
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSending, setContactSending] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSuccess, setContactSuccess] = useState<string | null>(null);

  const videos = [
    { id: 1, url: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/1.mp4` },
    { id: 2, url: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/2.mp4` },
    { id: 3, url: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/3.mp4` },
    { id: 4, url: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/4.mp4` },
  ];

  return (
    <div className='min-h-screen w-full bg-white'>
      <div className='max-w-7xl mx-auto px-6 py-6'>
        <div className='flex items-center justify-between mb-8'>
          <div className='flex items-center gap-3'>
            <img
              src='/logo_bis.png'
              alt='PayLive'
              className='sm:h-16 h-10 w-auto'
            />
          </div>
          <div className='flex items-center gap-3'>
            <a
              href='/howitworks'
              className='hidden md:inline-flex px-5 py-2.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50'
              onClick={e => {
                e.preventDefault();
                setShowFaqModal(true);
              }}
            >
              Consulter notre FAQ
            </a>
            <a
              href='/howitworks'
              className='hidden md:inline-flex px-5 py-2.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50'
              onClick={e => {
                e.preventDefault();
                setShowContactModal(true);
              }}
            >
              Je veux une démo
            </a>
            <button
              onClick={() => navigate('/onboarding')}
              className='relative px-2 py-2 text-sm sm:text-base sm:px-5 sm:py-2.5 rounded-md text-white bg-gradient-to-r 
              from-purple-600 to-blue-600 shadow-[0_0_18px_rgba(99,102,241,0.55)] 
              ring-2 ring-purple-400/50 transition-transform duration-200 hover:-translate-y-0.5'
            >
              Créer ma boutique
            </button>
          </div>
        </div>

        <div className='grid md:grid-cols-2 gap-8 items-start'>
          <div className='w-full max-w-xl mx-auto'>
            <div className='space-y-6'>
              <h2 className='text-7xl sm:text-5xl md:text-7xl lg:text-9xl font-bold text-gray-800'>
                Facilite toi la vie pendant tes live
              </h2>
              <p className='text-gray-700 text-base sm:text-base md:text-lg'>
                Génère en quelques secondes des liens de paiement, encaisse
                instantanément, et expédie facilement avec des tarifs négociés.
              </p>
            </div>
          </div>

          <div className='w-full max-w-[360px] sm:max-w-[480px] md:max-w-[720px] mx-auto mt-1 md:mt-0'>
            <div className='rounded-2xl overflow-hidden aspect-square'>
              <div className='grid grid-cols-2 grid-rows-2 h-full w-full gap-0'>
                {videos.slice(0, 4).map(v => (
                  <div key={v.id} className='relative overflow-hidden'>
                    <video
                      src={v.url}
                      className='absolute inset-0 w-full h-full object-cover'
                      muted
                      autoPlay
                      loop
                      playsInline
                      controls={false}
                      disablePictureInPicture
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className='mt-12'>
          <h3 className='text-3xl font-bold text-gray-800 mb-6'>
            Comment ça marche?
          </h3>
          <h2 className='mb-4 text-xl text-gray-800'>
            Le principe est super simple
          </h2>
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'>
            {[
              {
                src: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/00.jpg`,
                text: '1️⃣ Ton client se connecte à PayLive',
                subtext: 'Via son email ou son compte Google.',
              },
              {
                src: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/01.jpg`,
                text: '2️⃣ Tape la référence + le prix annoncé',
                subtext: "Possibilité d'ajouté plusieurs références au panier.",
              },
              {
                src: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/02.jpg`,
                text: '3️⃣ Choisit une adresse de livraison',
                subtext:
                  "L'adresse est enregistrée automatiquement après le premier achat. Livraison vers la France, Belgique et la Suisse.",
              },
              {
                src: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/03.jpg`,
                text: '4️⃣ Sélectionne un mode de livraison',
                subtext:
                  'Livraison en point relais, à domicile et le retrait en magasin.',
              },
              {
                src: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/04.jpg`,
                text: '5️⃣ Chosisit un mode de paiement',
                subtext:
                  'Possibilité d’utiliser des codes promos personnalisés.',
              },
              {
                src: `${import.meta.env.VITE_CLOUDFRONT_URL}/demo/05.jpg`,
                text: '6️⃣ Suivi des commandes dans le dashboard',
                subtext:
                  'Suivi en temps réel + notifications automatiques à chaque étape.',
              },
            ].map((s, idx) => (
              <div key={idx} className='space-y-2'>
                <div className='text-xl text-gray-800'>{s.text}</div>
                <div className='text-sm text-gray-800'>{s.subtext}</div>
                <img
                  src={s.src}
                  alt={`Étape ${idx}`}
                  className='w-3/4 h-auto mx-auto'
                />
              </div>
            ))}
          </div>
        </div>

        <div className='mt-12'>
          <h3 className='text-3xl font-bold text-gray-800 mb-4'>
            Et toi, pendant ce temps?
          </h3>
          <div className='space-y-2 overflow-x-auto'>
            <div className='text-xl text-gray-800'>
              Tu pilotes tout depuis ton dashboard: • génération du bordereau •
              préparation & expédition • encaissements • gestion complète des
              commandes • suivi des clients et de leurs achats 💅
            </div>
            <br />
            <div className='flex justify-center'>
              <img
                src={`${import.meta.env.VITE_CLOUDFRONT_URL}/demo/06.jpg`}
                alt='dashboard'
                className='w-full h-auto max-w-none'
              />
            </div>
          </div>
          <div className='mt-6 grid grid-cols-1 md:grid-cols-2 gap-6'>
            <div className='space-y-2'>
              <div className='text-xl text-gray-800'>
                Retire tes gains quand tu veux 💸
              </div>
              <div className='text-sm text-gray-800'>
                Versements rapides, flexibles, sans délais cachés.
              </div>
              <img
                src={`${import.meta.env.VITE_CLOUDFRONT_URL}/demo/07.jpg`}
                alt='payout'
                className='w-full h-auto mx-auto'
              />
            </div>

            <div className='space-y-2'>
              <div className='text-xl text-gray-800'>
                Et si tes clients sont un peu… fainéants 😭 ?
              </div>
              <div className='text-sm text-gray-800'>
                Tu peux créer le panier à leur place. Ils n’ont plus qu’à
                cliquer sur “payer”. Magique ✨
              </div>
              <img
                src={`${import.meta.env.VITE_CLOUDFRONT_URL}/demo/08.jpg`}
                alt='panier'
                className='w-full h-auto mx-auto'
              />
            </div>
          </div>
          <div className='mt-8 space-y-2'>
            <div className='mb-8'>
              <div className='text-2xl font-semibold text-gray-800'>
                💰 On a négocié les meilleurs tarifs pour toi
              </div>
              <div className='text-base text-gray-700'>
                Livraison en point relais depuis la France vers la France
              </div>
              {(() => {
                const carriers = [
                  {
                    key: 'Mondial relay',
                    label: 'Mondial Relay',
                    logo: 'https://upload.wikimedia.org/wikipedia/fr/1/19/Mondial_Relay.svg',
                    weights: {
                      '500g': { paylive: 4.25, website: 4.49 },
                      '1kg': { paylive: 4.63, website: 5.69 },
                      '2kg': { paylive: 6.14, website: 6.99 },
                      '3kg': { paylive: 6.34, website: 7.69 },
                      '4kg': { paylive: 6.53, website: 9.29 },
                    },
                  },
                  {
                    key: 'colis privé',
                    label: 'Colis Privé',
                    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Colis_Priv%C3%A9.svg/926px-Colis_Priv%C3%A9.svg.png',
                    weights: {
                      '500g': { paylive: 3.88, website: 4.4 },
                      '1kg': { paylive: 4.32, website: 6.5 },
                      '2kg': { paylive: 5.7, website: 6.5 },
                      '3kg': { paylive: 5.92, website: 6.5 },
                      '4kg': { paylive: 6.26, website: 6.5 },
                    },
                  },
                  {
                    key: 'relais colis',
                    label: 'Relais Colis',
                    logo: 'https://logovectorseek.com/wp-content/uploads/2021/05/relais-colis-logo-vector.png',
                    weights: {
                      '500g': { paylive: 4.11, website: 4.2 },
                      '1kg': { paylive: 4.2, website: 4.5 },
                      '2kg': { paylive: 5.81, website: 6.4 },
                      '3kg': { paylive: 6.04, website: 6.6 },
                      '4kg': { paylive: 6.35, website: 6.95 },
                    },
                  },
                  {
                    key: 'Chronopost',
                    label: 'Chronopost',
                    logo: 'https://www.soflock.com/2675-large_default/complement-livraison-express-par-chronopost.jpg',
                    weights: {
                      '500g': { paylive: 3.74, website: 4.2 },
                      '1kg': { paylive: 4.18, website: 6.5 },
                      '2kg': { paylive: 5.18, website: 6.5 },
                      '3kg': { paylive: 5.78, website: 6.5 },
                      '4kg': { paylive: 7.2, website: 13.9 },
                    },
                  },
                ];
                const order = ['500g', '1kg', '2kg', '3kg', '4kg'];
                return (
                  <div className='mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
                    {carriers.map(c => (
                      <div
                        key={c.key}
                        className='rounded-lg border border-gray-200 bg-white p-4 shadow-sm'
                      >
                        <div className='flex items-center gap-3 mb-3'>
                          <img
                            src={c.logo}
                            alt={c.label}
                            className='h-8 w-auto object-contain'
                          />
                          <div className='text-base font-semibold text-gray-800'>
                            {c.label}
                          </div>
                          {(() => {
                            const entries = Object.values(
                              c.weights || {}
                            ) as any[];
                            const percents = entries
                              .filter(
                                (w: any) =>
                                  typeof w?.paylive === 'number' &&
                                  typeof w?.website === 'number' &&
                                  w.website > 0
                              )
                              .map(
                                (w: any) =>
                                  ((w.website - w.paylive) / w.website) * 100
                              );
                            const avg =
                              percents.length > 0
                                ? percents.reduce(
                                    (a: number, b: number) => a + b,
                                    0
                                  ) / percents.length
                                : null;
                            return avg != null ? (
                              <span className='ml-auto inline-block rounded-full bg-green-100 text-green-700 text-xs px-2 py-0.5'>
                                - {Math.round(avg)}% en moyenne
                              </span>
                            ) : null;
                          })()}
                        </div>
                        <table className='w-full text-sm'>
                          <thead>
                            <tr className='text-gray-700'>
                              <th className='text-left py-2'>Poids</th>
                              <th className='text-left py-2'>PayLive</th>
                              <th className='text-left py-2'>Site</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order
                              .filter(w => (c.weights as any)[w])
                              .map(w => {
                                const info = (c.weights as any)[w] || {};
                                const pay =
                                  typeof info?.paylive === 'number'
                                    ? info.paylive
                                    : null;
                                const site =
                                  typeof info?.website === 'number'
                                    ? info.website
                                    : null;
                                const econ =
                                  pay != null && site != null
                                    ? site - pay
                                    : null;
                                const label = `${w}`;
                                return (
                                  <tr
                                    key={w}
                                    className='border-t border-gray-100'
                                  >
                                    <td className='py-2 text-gray-700'>
                                      {label}
                                    </td>
                                    <td className='py-2'>
                                      {pay != null ? (
                                        <span className='inline-block bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent font-bold'>
                                          {pay.toFixed(2)} €
                                        </span>
                                      ) : (
                                        <span className='text-gray-400'>—</span>
                                      )}
                                      {econ != null ? (
                                        <span className='ml-2 inline-block rounded-full bg-green-100 text-green-700 text-xs px-2 py-0.5'>
                                          - {econ.toFixed(2)} €
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className='py-2 text-gray-700'>
                                      {site != null ? (
                                        <span>{site.toFixed(2)} €</span>
                                      ) : (
                                        <span className='text-gray-400'>—</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div className='text-2xl font-semibold text-gray-800'>
              🎁 En bonus
            </div>
            <ul className='list-disc pl-6 text-gray-800'>
              <li>
                Codes promo personnalisés → Boostez vos ventes en un clic.
              </li>
              <li>
                Programme de fidélité automatique → Chaque achat génère des
                points.
              </li>
              <li>
                Rappels automatiques → Paniers abandonnés, notifications de
                live… on s’occupe de tout.
              </li>
              <li>
                IA de recommandation → Grâce à notre base multi-boutiques,
                PayLive recommande ton live à des clients qui aiment déjà ce
                type de produits.
              </li>
            </ul>
          </div>
        </div>

        <div className='hidden mt-12'>
          <h3 className='text-4xl font-bold text-gray-800 mb-4'>
            Et le prix dans tout ça?
          </h3>
          <div className='space-y-2 text-gray-800'>
            <p className='text-3xl  font-bold text-gray-800'>
              Seulement{' '}
              <span className='inline-block align-middle bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text mb-2 text-transparent text-4xl md:text-5xl font-extrabold'>
                4%
              </span>{' '}
              par vente
            </p>
            <p className='text-xl  text-gray-800'>Pas d’abonnement.</p>
            <p className='text-xl  text-gray-800'>Pas de frais d’ouverture.</p>
            <p className='text-xl  text-gray-800'>Pas de pièges.</p>
            <p className='text-xl font-bold text-gray-800'>
              Et parceque on t'aime déjà 😇, ton premier mois à seulement{' '}
              <span className='inline-block align-middle bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text mb-2 text-transparent text-4xl md:text-5xl font-extrabold'>
                1%
              </span>{' '}
            </p>
            <p className='text-xl  text-gray-800'>
              Zéro engagement. Zéro préavis. Zéro prise de tête.
            </p>
          </div>
        </div>

        <div className='mt-12'>
          <h3 className='text-4xl font-bold text-gray-800 mb-4'>On s’y met?</h3>
          <div className='space-y-2 text-gray-800'>
            <p className='text-xl  text-gray-800'>
              Si tu veux, je peux te faire une mini démo express (Promis, c’est
              rapide). On pourra créer ta boutique et la personnaliser selon ton
              style (logo, couleurs, photos…).
            </p>
            <p>Ou tu peux le faire toi-même en 2 minutes.</p>
          </div>
          <div className='mt-4 flex flex-wrap gap-3 justify-center'>
            <button
              onClick={() => setShowFaqModal(true)}
              className='px-5 py-2.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50'
            >
              Consulter notre FAQ
            </button>
            <button
              onClick={() => setShowContactModal(true)}
              className='px-5 py-2.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50'
            >
              Je veux une démo
            </button>
            <button
              onClick={() => navigate('/onboarding')}
              className='relative px-5 py-2.5 rounded-md text-white bg-gradient-to-r 
              from-purple-600 to-blue-600 shadow-[0_0_18px_rgba(99,102,241,0.55)] ring-2
               ring-purple-400/50 transition-transform duration-200 hover:-translate-y-0.5'
            >
              Créer ma boutique
            </button>
          </div>
        </div>

        <div className='mt-12'>
          <h3 className='text-2xl font-bold text-gray-800 mb-4'>À propos</h3>
          <div className='space-y-3 text-gray-800'>
            <p>Cette page n’a pas été générée par une IA.</p>
            <p>
              Paylive, c’est une équipe de développeuses et développeurs
              passionnés qui veulent résoudre un vrai frein : permettre aux
              liveuses et liveurs d’atteindre leur plein potentiel sans galères
              techniques, sans paniers qui bug, sans clients perdus dans les
              paiements.
            </p>
            <p className='font-semibold'>Notre mission est simple :</p>
            <p>
              👉 créer la plateforme la plus intuitive, la plus rapide et la
              plus agréable pour vendre en live.
            </p>
            <p>
              👉 écouter réellement nos utilisateurs et améliorer Paylive en
              continu.
            </p>
            <p>
              👉 co-construire avec vous une solution qui vous fait gagner du
              temps, de l’argent et de l’énergie.
            </p>
            <p>
              Nous sommes ouverts à toutes vos propositions, remarques et idées.
              On veut bâtir Paylive avec vous, pas juste pour vous.
            </p>
            <p className='font-semibold'>Et surtout :</p>
            <p>
              📧 On répond 7 jours sur 7. Que ce soit un bug, une question, une
              idée ou même un coup de gueule — on est là.
            </p>
          </div>
        </div>

        <footer className='mt-40 border-t pt-6 text-sm text-gray-600'>
          <div className='flex items-center justify-between'>
            <div>Fait avec ❤️ par © 2025 Paylive — Tous droits réservés.</div>
            <div className='flex gap-4'>
              <a
                href='https://www.tiktok.com/@paylive.cc'
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1'
              >
                <FaTiktok className='w-5 h-5' />
                <span className='hover:underline'>TikTok</span>
              </a>
              <a
                href='https://facebook.com/paylive.cc'
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1'
              >
                <FaFacebook className='w-5 h-5' />
                <span className='hover:underline'>Facebook</span>
              </a>
            </div>
          </div>
        </footer>
        {showFaqModal && (
          <div
            className='fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center'
            onClick={() => setShowFaqModal(false)}
          >
            <div
              className='relative w-full max-w-4xl mx-auto bg-white rounded-lg shadow-xl overflow-hidden'
              onClick={e => e.stopPropagation()}
            >
              <div className='flex items-center justify-between p-4 border-b'>
                <h2 className='text-xl font-semibold text-gray-900'>FAQ</h2>
                <button
                  className='px-3 py-1 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700'
                  onClick={() => setShowFaqModal(false)}
                  aria-label='Fermer'
                  title='Fermer'
                >
                  Fermer
                </button>
              </div>
              <div className='p-6 overflow-y-auto max-h-[calc(100vh-8rem)]'>
                <div className='text-center mb-6'>
                  <p className='text-3xl md:text-3xl font-bold text-gray-900'>
                    Seulement{' '}
                    <span className='inline-block align-middle bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text mb-2 text-transparent text-4xl md:text-5xl font-extrabold'>
                      4%
                    </span>{' '}
                    de commission
                  </p>
                  <p className='text-xl md:text-xl font-bold text-gray-900'>
                    <br />
                    Aucun frais caché
                  </p>
                </div>
                <div className='divide-y'>
                  {[
                    {
                      title: '💸 Paiements instantanés et sans effort',
                      content: (
                        <>
                          Avec PayLive, finis les messages, récapitulatifs ou
                          liens manuels à envoyer pour être payé.
                          <br />
                          Crée ton <b className='font-bold'>
                            lien de paiement
                          </b>{' '}
                          en <b className='font-bold'>2 clics</b>, ajoute-le
                          dans ta bio et commence à encaisser tes{' '}
                          <b className='font-bold'>articles instantanément</b>.
                        </>
                      ),
                    },
                    {
                      title: '🚚 Un seul paiement pour les frais de livraison',
                      content: (
                        <>
                          Sur PayLive, tes <b className='font-bold'>clients</b>{' '}
                          peuvent acheter{' '}
                          <b className='font-bold'>plusieurs articles</b> au
                          cours d’une même session live et ne paient qu’une
                          seule fois les{' '}
                          <b className='font-bold'>frais d’expédition</b>.
                          <br />
                          Une expérience <b className='font-bold'>
                            fluide
                          </b> et <b className='font-bold'>sans friction</b> ={' '}
                          <b className='font-bold'>plus de conversions</b> et{' '}
                          <b className='font-bold'>plus de ventes</b> !
                        </>
                      ),
                    },
                    {
                      title: '🧾 Fusion et génération automatique des factures',
                      content: (
                        <>
                          Plus besoin de passer des heures à éditer tes{' '}
                          <b className='font-bold'>factures</b>.<br />
                          PayLive regroupe automatiquement les{' '}
                          <b className='font-bold'>commandes</b> d’un même
                          client et génère une{' '}
                          <b className='font-bold'>facture unique</b> en un
                          clic.
                          <br />
                          Tu gagnes du <b className='font-bold'>temps</b> et ton
                          client reçoit des{' '}
                          <b className='font-bold'>documents clairs</b> et{' '}
                          <b className='font-bold'>professionnels</b>.
                        </>
                      ),
                    },
                    {
                      title: '🖨 Imprime tes étiquettes en un seul clic',
                      content: (
                        <>
                          PayLive est connecté aux{' '}
                          <b className='font-bold'>principaux transporteurs</b>.
                          <br />
                          En un clic, tu peux imprimer tous tes{' '}
                          <b className='font-bold'>bons de livraison</b> et
                          préparer tes <b className='font-bold'>colis</b> sans
                          saisie manuelle.
                          <br />
                          Le tout depuis ton{' '}
                          <b className='font-bold'>tableau de bord</b> —{' '}
                          <b className='font-bold'>simple</b>,{' '}
                          <b className='font-bold'>rapide</b> et{' '}
                          <b className='font-bold'>automatisé</b>.
                        </>
                      ),
                    },
                    {
                      title: '📦 Connecté à tous les transporteurs majeurs',
                      content: (
                        <>
                          PayLive est compatible avec{' '}
                          <b className='font-bold'>Colissimo</b>,{' '}
                          <b className='font-bold'>Mondial Relay</b>,{' '}
                          <b className='font-bold'>Chronopost</b>,{' '}
                          <b className='font-bold'>UPS</b>,{' '}
                          <b className='font-bold'>DHL</b>, etc.
                          <br />
                          Ton client peut choisir son{' '}
                          <b className='font-bold'>transporteur préféré</b> ou
                          laisser PayLive sélectionner automatiquement le{' '}
                          <b className='font-bold'>plus rapide</b> et le{' '}
                          <b className='font-bold'>plus économique</b>.<br />
                          Grâce à nos{' '}
                          <b className='font-bold'>partenariats logistiques</b>,
                          tu profites de{' '}
                          <b className='font-bold'>tarifs négociés</b> jusqu’à{' '}
                          <b className='font-bold'>50 % moins chers</b>.
                        </>
                      ),
                    },
                    {
                      title: '⚖ Litiges & remboursements',
                      content: (
                        <>
                          En cas de <b className='font-bold'>litige</b> ou de{' '}
                          <b className='font-bold'>demande de remboursement</b>,
                          PayLive agit comme{' '}
                          <b className='font-bold'>tiers de confiance</b>.<br />
                          Notre équipe prend en charge la{' '}
                          <b className='font-bold'>gestion complète</b> du
                          dossier, la{' '}
                          <b className='font-bold'>vérification des preuves</b>{' '}
                          et le <b className='font-bold'>remboursement</b> si
                          nécessaire, pour protéger à la fois le{' '}
                          <b className='font-bold'>vendeur</b> et le{' '}
                          <b className='font-bold'>client</b>.
                        </>
                      ),
                    },
                    {
                      title:
                        '💳 Connecté à toutes les principales solutions de paiement',
                      content: (
                        <>
                          En un clic, PayLive se connecte à{' '}
                          <b className='font-bold'>PayPal</b>,{' '}
                          <b className='font-bold'>Revolut Pay</b>,{' '}
                          <b className='font-bold'>Klarna</b>,{' '}
                          <b className='font-bold'>Amazon Pay</b>,{' '}
                          <b className='font-bold'>Google Pay</b>,{' '}
                          <b className='font-bold'>Bancontact</b> et bien
                          d’autres.
                          <br />
                          PayLive s’appuie sur l’infrastructure{' '}
                          <b className='font-bold'>Stripe</b> pour garantir des{' '}
                          <b className='font-bold'>paiements 100 % sécurisés</b>
                          , <b className='font-bold'>rapides</b> et{' '}
                          <b className='font-bold'>traçables</b>.<br />
                          Dès qu’un{' '}
                          <b className='font-bold'>paiement réussit</b>, tu
                          reçois une{' '}
                          <b className='font-bold'>notification instantanée</b>.
                          <br />
                          Les <b className='font-bold'>fonds</b> sont stockés
                          dans ton{' '}
                          <b className='font-bold'>porte-monnaie PayLive</b> et
                          peuvent être{' '}
                          <b className='font-bold'>retirés à tout moment</b>{' '}
                          vers ton <b className='font-bold'>compte bancaire</b>.
                        </>
                      ),
                    },
                    {
                      title: '🧠 Aucune compétence technique requise',
                      content: (
                        <>
                          Pas besoin de créer une{' '}
                          <b className='font-bold'>boutique</b> ou de gérer un{' '}
                          <b className='font-bold'>catalogue complexe</b>.<br />
                          Avec PayLive, tu choisis{' '}
                          <b className='font-bold'>quoi vendre</b>,{' '}
                          <b className='font-bold'>quand</b> et{' '}
                          <b className='font-bold'>à quel prix</b>, puis tu
                          partages simplement un{' '}
                          <b className='font-bold'>lien sécurisé</b>.<br />
                          Tout est géré pour toi —{' '}
                          <b className='font-bold'>paiement</b>,{' '}
                          <b className='font-bold'>facture</b>,{' '}
                          <b className='font-bold'>expédition</b> et{' '}
                          <b className='font-bold'>suivi</b>.
                        </>
                      ),
                    },
                    {
                      title: '🌍 Dans quels pays PayLive est disponible?',
                      content: (
                        <>
                          PayLive permet aux vendeurs d'expedier leur colis
                          depuis la France vers les pays suivants :
                          <br />
                          <b className='font-bold flex flex-row items-center gap-2'>
                            France
                          </b>
                          <b className='font-bold flex flex-row items-center gap-2'>
                            Belgique
                          </b>
                          <b className='font-bold flex flex-row items-center gap-2'>
                            Suisse
                          </b>
                        </>
                      ),
                    },
                    {
                      title: '🧰 Support & assistance',
                      content: (
                        <>
                          Notre <b className='font-bold'>équipe support</b> est
                          disponible et <b className='font-bold'>réactive</b>,
                          joignable à tout moment pour t’accompagner, que ce
                          soit par <b className='font-bold'>chat</b>,{' '}
                          <b className='font-bold'>e-mail</b> ou{' '}
                          <b className='font-bold'>téléphone</b>.
                          <br />
                          Que ce soit pour une{' '}
                          <b className='font-bold'>question technique</b>, un{' '}
                          <b className='font-bold'>suivi de paiement</b> ou une{' '}
                          <b className='font-bold'>aide sur ton compte</b>, tu
                          auras toujours une{' '}
                          <b className='font-bold'>réponse rapide</b> et{' '}
                          <b className='font-bold'>personnalisée</b>.
                        </>
                      ),
                    },
                    {
                      title: '🎯 Et enfin, le meilleur pour la fin',
                      content: (
                        <>
                          Avec PayLive, tu ne payes que lorsque tu{' '}
                          <b className='font-bold'>vends</b>.
                          <br />
                          Aucun <b className='font-bold'>abonnement</b>, aucun{' '}
                          <b className='font-bold'>
                            frais d’ouverture de compte
                          </b>{' '}
                          :
                          <br />
                          <b className='font-bold'>
                            🟢 Si tu ne vends pas, tu ne payes rien.
                          </b>
                          <br />
                          <b className='font-bold'>
                            🟢 Si tu vends, tu ne payes que 4 % du montant (hors
                            TVA et hors frais d’envoi).
                          </b>
                        </>
                      ),
                    },
                  ].map((faq, idx) => (
                    <details key={idx} className='group'>
                      <summary className='cursor-pointer py-3 flex items-center justify-between'>
                        <span className='font-semibold text-gray-800'>
                          {faq.title}
                        </span>
                        <span className='ml-2 text-gray-500'>
                          <ChevronDown className='w-5 h-5 group-open:hidden inline' />
                          <ChevronUp className='w-5 h-5 hidden group-open:inline' />
                        </span>
                      </summary>
                      <div className='py-2 text-gray-700 whitespace-pre-line'>
                        {faq.content}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {showContactModal && (
          <div
            className='fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center'
            onClick={() => setShowContactModal(false)}
          >
            <div
              className='relative w-full max-w-md mx-auto bg-white rounded-lg shadow-xl overflow-hidden'
              onClick={e => e.stopPropagation()}
            >
              <div className='flex items-center justify-between p-4 border-b'>
                <h2 className='text-xl font-semibold text-gray-900'>
                  Demande de démo
                </h2>
                <button
                  className='px-3 py-1 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700'
                  onClick={() => setShowContactModal(false)}
                >
                  Fermer
                </button>
              </div>
              <div className='p-6 space-y-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Email *
                  </label>
                  <input
                    type='email'
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    className='w-full border border-gray-300 rounded-md px-3 py-2'
                    placeholder='votre@email.com'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Nom
                  </label>
                  <input
                    type='text'
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    className='w-full border border-gray-300 rounded-md px-3 py-2'
                    placeholder='Votre nom (optionnel)'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Téléphone
                  </label>
                  <input
                    type='tel'
                    value={contactPhone}
                    onChange={e => setContactPhone(e.target.value)}
                    className='w-full border border-gray-300 rounded-md px-3 py-2'
                    placeholder='Votre téléphone (optionnel)'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Un message à nous faire passer
                  </label>
                  <textarea
                    value={contactMessage}
                    onChange={e => setContactMessage(e.target.value)}
                    className='w-full border border-gray-300 rounded-md px-3 py-2'
                    placeholder='Expliquez votre besoin, vos disponibilités, etc.'
                    rows={4}
                  />
                </div>
                {contactError && (
                  <div className='text-sm text-red-600'>{contactError}</div>
                )}
                {contactSuccess && (
                  <div className='text-sm text-green-600'>{contactSuccess}</div>
                )}
                <div className='flex justify-end gap-2 pt-2'>
                  <button
                    onClick={async () => {
                      setContactError(null);
                      setContactSuccess(null);
                      const email = (contactEmail || '').trim();
                      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                        setContactError('Email obligatoire et valide');
                        return;
                      }
                      try {
                        setContactSending(true);
                        const apiUrl =
                          import.meta.env.VITE_API_URL ||
                          'http://localhost:5000';
                        const resp = await fetch(
                          `${apiUrl}/api/admin/demo-request`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              email,
                              name: contactName || null,
                              phone: contactPhone || null,
                              message: contactMessage || null,
                            }),
                          }
                        );
                        const json = await resp.json().catch(() => ({}));
                        if (resp.ok) {
                          setContactSuccess(
                            'Votre demande a été envoyée. Nous revenons vers vous très vite.'
                          );
                          setContactName('');
                          setContactEmail('');
                          setContactPhone('');
                          setContactMessage('');
                        } else {
                          setContactError(
                            (json as any)?.error ||
                              'Erreur lors de l’envoi. Réessayez plus tard.'
                          );
                        }
                      } catch (e: any) {
                        setContactError(e?.message || 'Erreur réseau');
                      } finally {
                        setContactSending(false);
                      }
                    }}
                    className='px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60'
                    disabled={contactSending}
                  >
                    {contactSending ? 'Envoi...' : 'Envoyer ma demande'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LandingPageBis;
