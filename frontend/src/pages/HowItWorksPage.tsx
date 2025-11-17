import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown, Heart } from 'lucide-react';
import { BE, FR } from 'country-flag-icons/react/3x2';

const HowItWorksPage = () => {
  const navigate = useNavigate();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [likedVideos, setLikedVideos] = useState<Set<number>>(new Set());
  const [isDesktop, setIsDesktop] = useState(false);
  const [showFaqModal, setShowFaqModal] = useState(false);

  // Handle CTA button click
  const handleCTAClick = () => {
    navigate('/onboarding');
  };

  // Check if desktop and mobile capabilities
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 768);
    };

    // Force video autoplay policy for mobile
    const enableMobileVideo = () => {
      if ('serviceWorker' in navigator) {
        // Enable hardware acceleration for better video performance
        document.documentElement.style.setProperty(
          '--webkit-transform',
          'translateZ(0)'
        );
      }

      // Add mobile-specific meta tags for video optimization
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        viewport.setAttribute(
          'content',
          'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no'
        );
      }
    };

    checkDesktop();
    enableMobileVideo();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const videos = [
    {
      id: 1,
      url: 'https://app.videas.fr/embed/media/e98e050e-ed46-455b-a9b4-9dc5c872ce8f/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Comment ça marche',
      description:
        'Découvrez comment PayLive révolutionne vos paiements en ligne',
      likes: '2.3K',
      comments: '156',
      shares: '89',
    },
  ];
  const mobileVideos = [
    {
      id: 1,
      url: `${import.meta.env.VITE_CLOUDFRONT_URL}/videos/howitworks.mp4`,
      title: 'PayLive Comment ça marche',
      description:
        'Découvrez comment PayLive révolutionne vos paiements en ligne',
    },
  ];

  const activeVideos = isDesktop ? videos : mobileVideos;
  const videoRefs = useRef<HTMLVideoElement[]>([]);
  const tryPlay = (index: number) => {
    if (isDesktop) return;
    const v = videoRefs.current[index];
    if (v) {
      v.muted = true;
      v.play().catch(() => {});
    }
  };
  const ensurePlay = (index: number) => {
    if (isDesktop) return;
    const v = videoRefs.current[index];
    if (!v) return;
    v.muted = true;
    const attempt = () => {
      const p = v.play();
      if (p && typeof (p as any).catch === 'function') {
        (p as Promise<void>).catch(() => {
          setTimeout(attempt, 250);
        });
      }
    };
    if (v.readyState < 2) {
      const onCanPlay = () => {
        v.removeEventListener('canplay', onCanPlay);
        attempt();
      };
      v.addEventListener('canplay', onCanPlay);
    } else {
      attempt();
    }
  };

  useLayoutEffect(() => {
    if (isDesktop) return;
    ensurePlay(currentSlide);
  }, [currentSlide, isDesktop]);

  useEffect(() => {
    if (isDesktop) return;
    const handler = () => ensurePlay(currentSlide);
    document.addEventListener('touchend', handler, { once: true });
    document.addEventListener('click', handler, { once: true });
    return () => {
      document.removeEventListener('touchend', handler);
      document.removeEventListener('click', handler);
    };
  }, [currentSlide, isDesktop]);

  useEffect(() => {
    if (isDesktop) return;
    const v = videoRefs.current[currentSlide];
    if (!v) return;
    const playNow = () => tryPlay(currentSlide);
    playNow();
    v.addEventListener('loadedmetadata', playNow);
    v.addEventListener('canplay', playNow);
    return () => {
      v.removeEventListener('loadedmetadata', playNow);
      v.removeEventListener('canplay', playNow);
    };
  }, [currentSlide, isDesktop]);

  // Auto-play functionality
  useEffect(() => {
    if (!isAutoPlaying) return;
    const interval = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % activeVideos.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [isAutoPlaying, activeVideos.length]);

  // Preload current and next video for better mobile performance
  useEffect(() => {
    const preloadVideo = (url: string) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      const isMp4 = /\.mp4(\?|$)/i.test(url);
      link.as = isMp4 ? 'video' : 'document';
      document.head.appendChild(link);
      setTimeout(() => {
        if (document.head.contains(link)) {
          document.head.removeChild(link);
        }
      }, 10000);
    };
    if (activeVideos[currentSlide]) {
      preloadVideo(activeVideos[currentSlide].url);
    }
    const nextIndex = (currentSlide + 1) % activeVideos.length;
    if (activeVideos[nextIndex]) {
      preloadVideo(activeVideos[nextIndex].url);
    }
    tryPlay(currentSlide);
  }, [currentSlide, activeVideos]);

  const nextSlide = () => {
    setCurrentSlide(prev => (prev + 1) % activeVideos.length);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 3000);
  };

  const prevSlide = () => {
    setCurrentSlide(
      prev => (prev - 1 + activeVideos.length) % activeVideos.length
    );
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 3000);
  };

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 3000);
  };

  const toggleLike = (videoId: number) => {
    setLikedVideos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(videoId)) {
        newSet.delete(videoId);
      } else {
        newSet.add(videoId);
      }
      return newSet;
    });
  };

  return (
    <div className='h-screen w-full bg-white relative overflow-hidden flex flex-col'>
      {/* Header overlay - Mobile */}
      {!isDesktop && (
        <div className='absolute top-0 left-0 right-0 z-30 bg-black/50 backdrop-blur-sm p-1'>
          <div className='text-center'>
            <h1 className='text-white text-2xl font-bold'>PayLive</h1>
            <p className='text-white text-sm font-bold opacity-90'>
              Boostez vos ventes lors de vos Live Shopping
            </p>
          </div>
        </div>
      )}

      {/* Header overlay - Desktop */}
      {isDesktop && (
        <div className='absolute top-0 left-0 right-0 z-30 bg-black/50 p-6'>
          <div className='flex justify-between items-center'>
            <h1 className='text-white text-2xl font-bold'>PayLive</h1>
            <p className='text-white text-lg font-bold opacity-90'>
              Gérez efficacement vos ventes en Live Shopping
            </p>
          </div>
        </div>
      )}

      {/* Video Slider */}
      <div
        className='relative flex-1 w-full bg-black'
        onContextMenu={e => e.preventDefault()}
        onTouchStart={() => tryPlay(currentSlide)}
      >
        {activeVideos.map((video, index) => (
          <div
            key={video.id}
            className={`absolute inset-0 transition-transform duration-500 ease-in-out ${
              index === currentSlide
                ? 'translate-y-0'
                : index < currentSlide
                  ? '-translate-y-full'
                  : 'translate-y-full'
            }`}
          >
            {isDesktop ? (
              <iframe
                src={video.url}
                className='w-full h-full object-cover'
                frameBorder='0'
                allow='autoplay; fullscreen; accelerometer; gyroscope; picture-in-picture'
                allowFullScreen
                loading={index === currentSlide ? 'eager' : 'lazy'}
                sandbox='allow-scripts allow-same-origin allow-presentation'
                onContextMenu={e => e.preventDefault()}
                style={{
                  border: 'none',
                  outline: 'none',
                  WebkitTransform: 'translateZ(0)',
                  transform: 'translateZ(0)',
                }}
              />
            ) : (
              <video
                src={video.url}
                className='w-full h-full object-contain'
                muted
                autoPlay
                loop
                playsInline
                webkit-playsinline='true'
                preload='auto'
                controls={false}
                controlsList='nodownload nofullscreen noplaybackrate'
                disablePictureInPicture
                onContextMenu={e => e.preventDefault()}
                onLoadedData={() => tryPlay(index)}
                ref={el => {
                  if (el) videoRefs.current[index] = el;
                }}
                style={{
                  border: 'none',
                  outline: 'none',
                  WebkitTransform: 'translateZ(0)',
                  transform: 'translateZ(0)',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Right Side Actions - Desktop */}
      {isDesktop && (
        <div className='absolute right-4 bottom-6 z-20 flex flex-col space-y-6'>
          {/* Navigation Controls */}
          <div className='space-y-4'>
            <button
              onClick={prevSlide}
              className='w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all duration-300 hover:scale-110 backdrop-blur-sm'
            >
              <ChevronUp className='w-6 h-6' />
            </button>

            <button
              onClick={nextSlide}
              className='w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all duration-300 hover:scale-110 backdrop-blur-sm'
            >
              <ChevronDown className='w-6 h-6' />
            </button>
          </div>

          <button
            onClick={() => toggleLike(activeVideos[currentSlide].id)}
            className='flex flex-col items-center text-white hover:scale-110 transition-all duration-300'
          >
            <div className='w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-1 backdrop-blur-sm'>
              <Heart
                className={`w-6 h-6 transition-all duration-300 ${
                  likedVideos.has(activeVideos[currentSlide].id)
                    ? 'fill-red-500 text-red-500 scale-110'
                    : 'text-white'
                }`}
              />
            </div>
          </button>

          <button className='flex flex-col items-center text-white hover:scale-110 transition-transform'>
            <div className='w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-1 backdrop-blur-sm'>
              {/* Comment icon from attachment */}
              <svg
                className='w-6 h-6'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
                />
              </svg>
            </div>
          </button>
        </div>
      )}

      {/* Bottom CTA - Mobile */}
      {!isDesktop && (
        <div className='absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-4 z-30'>
          <div className='flex items-center gap-2 mb-5'>
            <button
              onClick={() => handleCTAClick()}
              className='flex-1 bg-gradient-to-r from-purple-600 to-blue-600 text-white 
              py-2 px-3 rounded-lg font-bold text-lg text-center hover:from-purple-700 hover:to-blue-700 
              transition-all duration-300 transform hover:scale-105 shadow-lg'
            >
              Essayez PayLive !
            </button>

            <a
              href='#'
              className='px-3 py-2 rounded-lg text-white text-sm font-medium bg-white/10 border border-white/30 hover:bg-white/20 transition-colors'
              onClick={e => {
                e.preventDefault();
                setShowFaqModal(true);
              }}
            >
              FAQ
            </a>
          </div>
        </div>
      )}

      {/* Bottom CTA - Desktop */}
      {isDesktop && (
        <div className='absolute bottom-0 left-0 bg-black/70 backdrop-blur-sm p-6 z-30 rounded-tr-lg'>
          <div className='space-y-3'>
            <button
              onClick={() => handleCTAClick()}
              className='block bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:from-purple-700 hover:to-blue-700 transition-all duration-300 transform hover:scale-105 shadow-lg animate-pulse hover:animate-none'
            >
              Essayez PayLive Gratuitement !
            </button>
            <a
              href='#'
              className='block text-center text-blue-400 underline hover:text-blue-300 transition-colors'
              onClick={e => {
                e.preventDefault();
                setShowFaqModal(true);
              }}
            >
              F.A.Q.
            </a>
          </div>
        </div>
      )}

      {/* FAQ Modal - full page, scrollable, closable, responsive */}
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
              {/* Big headline with gradient emphasis on 4% */}
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
                  <br />
                  <span className='inline-block align-middle bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-1 text-2xl md:text-2xl font-extrabold'>
                    0€
                  </span>{' '}
                  d'ouverture{' '}
                  <span className='inline-block align-middle bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-1 text-2xl md:text-2xl font-extrabold'>
                    0€
                  </span>{' '}
                  d'abonnement
                </p>
              </div>

              {/* Accordion FAQ détaillé */}
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
                        en <b className='font-bold'>2 clics</b>, ajoute-le dans
                        ta bio et commence à encaisser tes{' '}
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
                        <b className='font-bold'>plusieurs articles</b> au cours
                        d’une même session live et ne paient qu’une seule fois
                        les <b className='font-bold'>frais d’expédition</b>.
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
                        <b className='font-bold'>commandes</b> d’un même client
                        et génère une{' '}
                        <b className='font-bold'>facture unique</b> en un clic.
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
                        <b className='font-bold'>vérification des preuves</b> et
                        le <b className='font-bold'>remboursement</b> si
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
                        <b className='font-bold'>paiements 100 % sécurisés</b>,{' '}
                        <b className='font-bold'>rapides</b> et{' '}
                        <b className='font-bold'>traçables</b>.<br />
                        Dès qu’un <b className='font-bold'>paiement réussit</b>,
                        tu reçois une{' '}
                        <b className='font-bold'>notification instantanée</b>.
                        <br />
                        Les <b className='font-bold'>fonds</b> sont stockés dans
                        ton <b className='font-bold'>porte-monnaie PayLive</b>{' '}
                        et peuvent être{' '}
                        <b className='font-bold'>retirés à tout moment</b> vers
                        ton <b className='font-bold'>compte bancaire</b>.
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
                        PayLive est actuellement disponible dans les pays
                        suivants :<br />
                        <b className='font-bold flex flex-row items-center gap-2'>
                          <FR title='France' className='w-5 h-4' />
                          France
                        </b>
                        <b className='font-bold flex flex-row items-center gap-2'>
                          <BE title='Belgique' className='w-5 h-4' />
                          Belgique
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
                        joignable à tout moment pour t’accompagner, que ce soit
                        par <b className='font-bold'>chat</b>,{' '}
                        <b className='font-bold'>e-mail</b> ou{' '}
                        <b className='font-bold'>téléphone</b>.<br />
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
                        <b className='font-bold'>vends</b>.<br />
                        Aucun <b className='font-bold'>abonnement</b>, aucun{' '}
                        <b className='font-bold'>frais d’ouverture de compte</b>{' '}
                        :<br />
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
    </div>
  );
};

export default HowItWorksPage;
