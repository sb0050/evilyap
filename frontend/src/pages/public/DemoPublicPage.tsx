import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

type DemoConfig = {
  iframeSrc: string;
  paddingBottom: string;
};

const DEMO_CONFIG_BY_PATH: Record<string, DemoConfig> = {
  '/demo-vendeur': {
    iframeSrc: 'https://app.storylane.io/demo/mdfkvdls5bg4?embed=popup',
    paddingBottom: 'calc(53.79% + 25px)',
  },
  '/demo-client': {
    iframeSrc: 'https://app.storylane.io/demo/imptycbxswra?embed=popup',
    paddingBottom: 'calc(53.81% + 25px)',
  },
  '/demo-client-mobile': {
    iframeSrc: 'https://app.storylane.io/demo/arwuuwthb6nk?embed=popup',
    paddingBottom: 'calc(217.21% + 25px)',
  },
};

export default function DemoPublicPage() {
  const location = useLocation();
  const normalizedPath =
    String(location.pathname || '').replace(/\/+$/, '') || '/';
  const config = DEMO_CONFIG_BY_PATH[normalizedPath];

  useEffect(() => {
    const existing = document.querySelector(
      'script[src="https://js.storylane.io/js/v2/storylane.js"]'
    );
    if (existing) return;
    const script = document.createElement('script');
    script.src = 'https://js.storylane.io/js/v2/storylane.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  if (!config) {
    return <Navigate to='/' replace />;
  }

  return (
    <div className='min-h-screen w-full bg-white'>
      <div className='max-w-7xl mx-auto px-6 py-6'>
        <div className='flex items-center justify-between mb-8'>
          <div className='flex items-center gap-3'>
            <a href='https://paylive.cc'>
              <img
                src='/logo_bis.png'
                alt='PayLive'
                className='sm:h-16 h-10 w-auto'
              />
            </a>
          </div>
          <div className='flex items-center gap-3'>
            <a
              href='https://paylive.cc'
              className='hidden md:inline-flex px-5 py-2.5 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50'
            >
              Consulter notre FAQ
            </a>
            <a
              href='https://paylive.cc/needademo'
              className='relative px-2 py-2 text-sm sm:text-base sm:px-5 sm:py-2.5 rounded-md text-white bg-gradient-to-r from-purple-600 to-blue-600 shadow-[0_0_18px_rgba(99,102,241,0.55)] ring-2 ring-purple-400/50 transition-transform duration-200 hover:-translate-y-0.5'
            >
              Créer ma boutique
            </a>
          </div>
        </div>
        <div
          className='sl-embed'
          style={{
            position: 'relative',
            paddingBottom: config.paddingBottom,
            width: '100%',
            height: 0,
            transform: 'scale(1)',
          }}
        >
          <iframe
            loading='lazy'
            className='sl-demo'
            src={config.iframeSrc}
            name='sl-embed'
            allow='fullscreen'
            allowFullScreen
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: '1px solid rgba(63,95,172,0.35)',
              boxShadow: '0px 0px 18px rgba(26, 19, 72, 0.15)',
              borderRadius: '10px',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
    </div>
  );
}
