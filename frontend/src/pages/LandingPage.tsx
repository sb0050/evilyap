import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown, Heart } from 'lucide-react';

const LandingPage = () => {
  const navigate = useNavigate();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [likedVideos, setLikedVideos] = useState<Set<number>>(new Set());
  const [isDesktop, setIsDesktop] = useState(false);

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
      url: 'https://app.videas.fr/embed/media/f4a7bfde-3f77-4fe7-bffa-20447c90f877/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Demo 1',
      description:
        'Découvrez comment PayLive révolutionne vos paiements en ligne',
      likes: '2.3K',
      comments: '156',
      shares: '89',
    },
    {
      id: 2,
      url: 'https://app.videas.fr/embed/media/e3c464d8-a1ab-4e87-817b-927c7c115da6/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Demo 2',
      description: 'Intégration Stripe et Boxtal en quelques clics',
      likes: '1.8K',
      comments: '92',
      shares: '67',
    },
    {
      id: 3,
      url: 'https://app.videas.fr/embed/media/7d080e96-a0e0-46da-83bc-8a6cc055684c/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Demo 3',
      description: 'Gestion clients simplifiée avec PayLive',
      likes: '3.1K',
      comments: '203',
      shares: '124',
    },
    {
      id: 4,
      url: 'https://app.videas.fr/embed/media/5f5a0aa3-d7cd-47b2-97d6-93ae985d38dd/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Demo 3',
      description: 'Gestion clients simplifiée avec PayLive',
      likes: '10.4K',
      comments: '300',
      shares: '200',
    },
  ];

  // Auto-play functionality
  useEffect(() => {
    if (!isAutoPlaying) return;

    const interval = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % videos.length);
    }, 8000); // Change slide every 8 seconds

    return () => clearInterval(interval);
  }, [isAutoPlaying, videos.length]);

  // Preload current and next video for better mobile performance
  useEffect(() => {
    const preloadVideo = (url: string) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      link.as = 'document';
      document.head.appendChild(link);

      // Remove after 10 seconds to avoid the warning
      setTimeout(() => {
        if (document.head.contains(link)) {
          document.head.removeChild(link);
        }
      }, 10000);
    };

    // Preload current video
    if (videos[currentSlide]) {
      preloadVideo(videos[currentSlide].url);
    }

    // Preload next video
    const nextIndex = (currentSlide + 1) % videos.length;
    if (videos[nextIndex]) {
      preloadVideo(videos[nextIndex].url);
    }
  }, [currentSlide, videos]);

  const nextSlide = () => {
    setCurrentSlide(prev => (prev + 1) % videos.length);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 3000);
  };

  const prevSlide = () => {
    setCurrentSlide(prev => (prev - 1 + videos.length) % videos.length);
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
        <div className='absolute top-0 left-0 right-0 z-30 bg-black/50 backdrop-blur-sm p-4'>
          <div className='text-center'>
            <h1 className='text-white text-lg font-bold mb-1'>PayLive</h1>
            <p className='text-white text-sm font-bold opacity-90'>
              Gérez efficacement vos ventes en Live Shopping
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
      >
        {videos.map((video, index) => (
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
          </div>
        ))}
      </div>

      {/* Right Side Actions - Mobile */}
      {!isDesktop && (
        <div className='absolute right-4 bottom-20 z-20 flex flex-col space-y-6'>
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
            onClick={() => toggleLike(videos[currentSlide].id)}
            className='flex flex-col items-center text-white hover:scale-110 transition-all duration-300'
          >
            <div className='w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-1 backdrop-blur-sm'>
              <Heart
                className={`w-6 h-6 transition-all duration-300 ${
                  likedVideos.has(videos[currentSlide].id)
                    ? 'fill-red-500 text-red-500 scale-110'
                    : 'text-white'
                }`}
              />
            </div>
            <span className='text-xs font-semibold'>
              {videos[currentSlide].likes}
            </span>
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
            <span className='text-xs font-semibold mb-5'>
              {videos[currentSlide].comments}
            </span>
          </button>
        </div>
      )}

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
            onClick={() => toggleLike(videos[currentSlide].id)}
            className='flex flex-col items-center text-white hover:scale-110 transition-all duration-300'
          >
            <div className='w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-1 backdrop-blur-sm'>
              <Heart
                className={`w-6 h-6 transition-all duration-300 ${
                  likedVideos.has(videos[currentSlide].id)
                    ? 'fill-red-500 text-red-500 scale-110'
                    : 'text-white'
                }`}
              />
            </div>
            <span className='text-xs font-semibold'>
              {videos[currentSlide].likes}
            </span>
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
            <span className='text-xs font-semibold'>
              {videos[currentSlide].comments}
            </span>
          </button>
        </div>
      )}

      {/* Bottom CTA - Mobile */}
      {!isDesktop && (
        <div className='absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-4 z-30'>
          <div className='space-y-2'>
            <button
              onClick={() => handleCTAClick()}
              className='block w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-2 px-4 rounded-lg font-bold text-sm text-center hover:from-purple-700 hover:to-blue-700 transition-all duration-300 transform hover:scale-105 shadow-lg animate-pulse hover:animate-none'
            >
              Essayez PayLive Gratuitement !
            </button>
            <a
              href='#'
              className='block text-center text-blue-400 text-sm underline hover:text-blue-300 transition-colors'
            >
              Comment ça marche ?
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
              className='block text-blue-400 underline hover:text-blue-300 transition-colors'
            >
              Comment ça marche ?
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
