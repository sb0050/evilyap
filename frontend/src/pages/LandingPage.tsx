import React, { useState } from 'react';
import { FaFacebook, FaTiktok } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { BE, CH, FR } from 'country-flag-icons/react/3x2';
import { DemoEmbed } from '../components/DemoEmbed';

const LandingPage = () => {
  const navigate = useNavigate();
  const [showFaqModal, setShowFaqModal] = useState(false);

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
            <button
              onClick={() => navigate('/needademo')}
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
          <DemoEmbed />
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
          </div>
          <div className='mt-4 flex flex-wrap gap-3 justify-center'>
            <button
              onClick={() => setShowFaqModal(true)}
              className='px-5 py-2.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50'
            >
              Consulter notre FAQ
            </button>
            <button
              onClick={() => navigate('/needademo')}
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
                    <span
                      className='inline-block align-middle 
                    bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text mb-2 text-transparent 
                    text-4xl md:text-6xl font-extrabold'
                    >
                      0 €
                    </span>
                    {'   '}/ mois
                  </p>
                  <p className='text-xl md:text-xl font-bold text-gray-900'>
                    + seulement 3% de frais sur les commandes payées
                  </p>
                </div>
                <div className='divide-y'>
                  {[
                    {
                      title: '💸 Comment PayLive simplifie mes paiements ?',
                      content: (
                        <>
                          Fini les DM interminables, les récapitulatifs écrits à
                          la main et les clients qui « disparaissent » avant de
                          payer.
                          <br />
                          Avec PayLive, tu génères un{' '}
                          <b className='font-bold'>lien de paiement</b> en{' '}
                          <b className='font-bold'>2 clics</b> — depuis ton
                          live, ta bio ou tes stories — et ton client règle
                          instantanément.
                          <br />
                          Moins d’effort, zéro friction, plus de{' '}
                          <b className='font-bold'>ventes sécurisées</b>.
                        </>
                      ),
                    },
                    {
                      title:
                        '🚚 Mes clients doivent-ils payer plusieurs fois les frais d’expédition ?',
                      content: (
                        <>
                          Non.
                          <br />
                          S’ils achètent plusieurs articles pendant un même
                          live, PayLive{' '}
                          <b className='font-bold'>
                            fusionne automatiquement les achats
                          </b>
                          .
                          <br />
                          👉 Un seul paiement, une seule expédition, une
                          expérience beaucoup plus fluide.
                          <br />
                          Résultat : plus de panier moyen et moins d’abandons.
                        </>
                      ),
                    },
                    {
                      title:
                        '🧾 Est-ce que PayLive génère automatiquement mes factures ?',
                      content: (
                        <>
                          Oui.
                          <br />
                          PayLive regroupe toutes les{' '}
                          <b className='font-bold'>commandes</b> d’un même
                          client et crée une{' '}
                          <b className='font-bold'>facture unique</b>, propre et
                          professionnelle, prête à être envoyée ou téléchargée.
                          <br />
                          Plus de fichiers Excel, plus de copier-coller, plus de
                          nuits passées à facturer.
                        </>
                      ),
                    },
                    {
                      title:
                        '🖨 Puis-je imprimer mes étiquettes d’expédition facilement ?',
                      content: (
                        <>
                          Absolument.
                          <br />
                          Depuis ton tableau de bord, tu peux imprimer toutes
                          tes <b className='font-bold'>étiquettes</b> en un{' '}
                          <b className='font-bold'>clic</b>, sans aucune saisie
                          manuelle.
                          <br />
                          PayLive prépare automatiquement les informations de
                          livraison pour toi.
                        </>
                      ),
                    },
                    {
                      title: '📦 Quels transporteurs sont disponibles ?',
                      content: (
                        <>
                          PayLive est connecté à :
                          <br />
                          Colissimo, Mondial Relay, Chronopost, Colis Privé,
                          Relais Colis, Colissimo et Delivengo
                          <br />
                          Ton client choisit ce qu’il préfère, ou PayLive
                          sélectionne automatiquement l’option la{' '}
                          <b className='font-bold'>plus économique</b> et la{' '}
                          <b className='font-bold'>plus rapide</b>.
                          <br />
                          Grâce à nos partenaires logistiques, tu profiteras de{' '}
                          <b className='font-bold'>tarifs</b> jusqu’à{' '}
                          <b className='font-bold'>25 % moins chers</b>.
                        </>
                      ),
                    },
                    {
                      title:
                        '⚖ Que se passe-t-il en cas de litige ou demande de remboursement ?',
                      content: (
                        <>
                          PayLive joue le rôle de{' '}
                          <b className='font-bold'>tiers de confiance</b>.
                          <br />
                          Nous gérons :
                          <ul className='list-disc pl-6'>
                            <li>la vérification des preuves</li>
                            <li>la communication avec l’acheteur</li>
                            <li>le remboursement si nécessaire</li>
                          </ul>
                          Tu n’es jamais seul. Nous protégeons le vendeur autant
                          que le client, dans un cadre clair et pro.
                        </>
                      ),
                    },
                    {
                      title:
                        '💳 Quelles solutions de paiement sont compatibles ?',
                      content: (
                        <>
                          PayLive accepte tous les moyens modernes :
                          <br />
                          PayPal, Google Pay, Apple Pay et Carte bancaire
                          <br />
                          Le tout reposant sur{' '}
                          <b className='font-bold'>Stripe</b> : sécurisé, ultra
                          rapide et traçable.
                          <br />
                          Tu reçois une{' '}
                          <b className='font-bold'>
                            notification instantanée
                          </b>{' '}
                          dès qu’un paiement réussit et tu peux retirer tes
                          fonds à tout moment.
                        </>
                      ),
                    },
                    {
                      title:
                        '🧠 Je n’ai pas de boutique ni de compétences techniques, c’est un problème ?',
                      content: (
                        <>
                          Pas du tout.
                          <br />
                          PayLive est conçu pour les vendeurs qui veulent
                          vendre, pas gérer du technique.
                          <br />
                          Tu choisis quoi vendre, tu fixes un prix, tu envoies
                          ton lien — et PayLive s’occupe du reste :
                          <br />
                          paiement • facture • expédition • suivi.
                        </>
                      ),
                    },
                    {
                      title: '🌍 Dans quels pays PayLive fonctionne ?',
                      content: (
                        <>
                          Tu peux actuellement expédier depuis la France vers :
                          <br />
                          <FR
                            title='France'
                            className='inline-block w-6 h-4 mr-2 align-middle rounded-sm shadow-sm'
                          ></FR>{' '}
                          France
                          <br />
                          <BE
                            title='Belgique'
                            className='inline-block w-6 h-4 mr-2 align-middle rounded-sm shadow-sm'
                          ></BE>{' '}
                          Belgique
                          <br />
                          <CH
                            title='Suisse'
                            className='inline-block w-6 h-4 mr-2 align-middle rounded-sm shadow-sm'
                          ></CH>{' '}
                          Suisse
                        </>
                      ),
                    },
                    {
                      title:
                        '🧰 J’ai un problème : comment contacter PayLive ?',
                      content: (
                        <>
                          Notre équipe support est{' '}
                          <b className='font-bold'>réactive</b> et{' '}
                          <b className='font-bold'>disponible</b>, par :
                          <br />
                          Chat
                          <br />
                          Email
                          <br />
                          Téléphone
                          <br />
                          Que ce soit pour une question technique, un souci
                          d’envoi ou une vérification de paiement, nous te
                          répondons rapide et efficacement.
                        </>
                      ),
                    },
                    {
                      title: '🎯 Combien coûte PayLive ?',
                      content: (
                        <>
                          Tu ne payes que si tu vends.
                          <br />
                          Aucun abonnement, aucun engagement.
                          <br />
                          🟢 0 € si tu ne vends pas
                          <br />
                          🟢 3 % du montant si tu vends
                          <br />
                          Pas de surprise, pas de frais cachés.
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
      </div>
    </div>
  );
};

export default LandingPage;
