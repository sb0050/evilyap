import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { X, Copy, Check, ExternalLink } from 'lucide-react';

interface SuccessConfettiProps {
  show: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  shareLink?: string;
}

const SuccessConfetti: React.FC<SuccessConfettiProps> = ({
  show,
  onClose,
  title,
  subtitle,
  shareLink = 'https://paylive.cc/c/example',
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (show) {
      // Effet de confettis réaliste inspiré du fichier d'exemple
      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

      function randomInRange(min: number, max: number) {
        return Math.random() * (max - min) + min;
      }

      const interval: any = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Confettis depuis la gauche
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        });

        // Confettis depuis la droite
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        });
      }, 250);

      return () => clearInterval(interval);
    }
  }, [show]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Erreur lors de la copie:', err);
    }
  };

  if (!show) return null;

  return (
    <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 sm:p-6'>
      <div className='bg-white rounded-lg shadow-xl w-full max-w-md mx-4 sm:mx-0 overflow-hidden'>
        {/* Header simple et professionnel */}
        <div className='p-4 sm:p-6 border-b border-gray-200'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center space-x-3'>
              <div className='w-8 h-8 sm:w-10 sm:h-10 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0'>
                <span className='text-indigo-600 text-lg sm:text-xl'>✓</span>
              </div>
              <div className='min-w-0 flex-1'>
                <h2 className='text-base sm:text-lg font-semibold text-gray-900 truncate'>
                  Boutique créée
                </h2>
                <p className='text-xs sm:text-sm text-gray-600'>
                  Votre boutique est maintenant en ligne
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className='text-gray-400 hover:text-gray-600 transition-colors p-1 flex-shrink-0'
            >
              <X size={18} className='sm:w-5 sm:h-5' />
            </button>
          </div>
        </div>

        {/* Contenu principal */}
        <div className='p-4 sm:p-6 space-y-4'>
          {/* Section de partage de lien */}
          <div className='space-y-3'>
            <div className='flex items-center space-x-2 text-gray-700'>
              <ExternalLink size={14} className='sm:w-4 sm:h-4 flex-shrink-0' />
              <span className='text-xs sm:text-sm font-medium'>
                Lien de votre boutique
              </span>
            </div>

            <div className='flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 bg-gray-50 border border-gray-200 rounded-md p-3'>
              <input
                type='text'
                value={shareLink}
                readOnly
                className='flex-1 bg-transparent text-xs sm:text-sm text-gray-700 outline-none min-w-0 truncate'
              />
              <button
                onClick={handleCopy}
                className={`flex items-center justify-center space-x-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors w-full sm:w-auto flex-shrink-0 ${
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {copied ? <Check size={12} className='sm:w-3.5 sm:h-3.5' /> : <Copy size={12} className='sm:w-3.5 sm:h-3.5' />}
                <span>{copied ? 'Copié' : 'Copier'}</span>
              </button>
            </div>
          </div>

          {/* Message d'encouragement */}
          <div className='bg-indigo-50 border border-indigo-200 rounded-md p-3 sm:p-4'>
            <p className='text-xs sm:text-sm text-indigo-700 leading-relaxed'>
              Partagez ce lien avec vos clients pour qu'ils puissent effectuer
              des paiements directement sur votre boutique.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className='px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-200'>
          <button
            onClick={onClose}
            className='w-full bg-indigo-600 text-white py-2.5 sm:py-2 px-4 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors'
          >
            Commencer à utiliser ma boutique
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuccessConfetti;
