import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronUp,
  ChevronDown,
  Play,
  Heart,
  MessageCircle,
  Share,
  User,
} from 'lucide-react';

const MobileLandingPage = () => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [likedVideos, setLikedVideos] = useState<Set<number>>(new Set());
  const [isDesktop, setIsDesktop] = useState(false);

  // Check if desktop
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const videos = [
    {
      id: 1,
      url: 'https://app.videas.fr/embed/media/8d45dc3d-27e0-4e55-a67a-78caf64937c1/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Demo 1',
      description:
        'Découvrez comment PayLive révolutionne vos paiements en ligne',
      likes: '2.3K',
      comments: '156',
      shares: '89',
    },
    {
      id: 2,
      url: 'https://app.videas.fr/embed/media/3c65ff0b-6aef-47ac-92aa-32669b8310a2/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Demo 2',
      description: 'Intégration Stripe et Boxtal en quelques clics',
      likes: '1.8K',
      comments: '92',
      shares: '67',
    },
    {
      id: 3,
      url: 'https://app.videas.fr/embed/media/fbb19bd4-0ea1-48b7-a1ac-3874f881402f/?title=false&logo=false&thumbnail_duration=false&controls=false&autoplay=true&loop=true',
      title: 'PayLive Demo 3',
      description: 'Gestion clients simplifiée avec PayLive',
      likes: '3.1K',
      comments: '203',
      shares: '124',
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
              allow='autoplay; fullscreen'
              allowFullScreen
              onContextMenu={e => e.preventDefault()}
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
            <Link
              to='/checkout'
              className='block w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-bold text-sm text-center hover:bg-blue-700 transition-all duration-300 animate-pulse hover:animate-none hover:scale-105'
            >
              Essayez PayLive Gratuitement !
            </Link>
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
            <Link
              to='/checkout'
              className='block bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-blue-700 transition-all duration-300 animate-pulse hover:animate-none hover:scale-105'
            >
              Essayez PayLive Gratuitement !
            </Link>
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

export default MobileLandingPage;
