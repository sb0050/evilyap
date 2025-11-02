import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { Copy, ExternalLink } from 'lucide-react';
import type { IconType } from 'react-icons';
import { FaTiktok } from 'react-icons/fa6';
import { FaInstagram } from 'react-icons/fa';
import { FaFacebookF } from 'react-icons/fa6';
import { FaSnapchat } from 'react-icons/fa6';
import { FaWhatsapp } from 'react-icons/fa';

interface SuccessConfettiProps {
  onClose: () => void;
  shareLink?: string;
  isStorecreated?: boolean;
}

const SuccessConfetti: React.FC<SuccessConfettiProps> = ({
  onClose,
  shareLink = 'https://paylive.cc/c/example',
  isStorecreated = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState<boolean>(!!isStorecreated);

  useEffect(() => {
    if (isStorecreated) setVisible(true);
  }, [isStorecreated]);

  const headerTitle = '🎉 Félicitations 🎉';
  const headerSubtitle = 'Votre boutique est maintenant en ligne';
  const helperText =
    'Veuillez trouver ci-dessous le lien à copier dans la bio de vos réseaux sociaux';

  useEffect(() => {
    if (visible) {
      const count = 200;
      const defaults = { origin: { y: 0.7 } };

      function fire(particleRatio: number, opts: any) {
        confetti({
          ...defaults,
          ...opts,
          particleCount: Math.floor(count * particleRatio),
        });
      }

      const timer = setTimeout(() => {
        fire(0.25, { spread: 26, startVelocity: 55 });
        fire(0.2, { spread: 60 });
        fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
        fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
        fire(0.1, { spread: 120, startVelocity: 45 });
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Erreur lors de la copie:', err);
    }
  };

  // Factorisation des réseaux sociaux
  const socials: { label: string; Icon: IconType }[] = [
    { label: 'TikTok', Icon: FaTiktok },
    { label: 'Instagram', Icon: FaInstagram },
    { label: 'Facebook', Icon: FaFacebookF },
    { label: 'Snapchat', Icon: FaSnapchat },
    { label: 'WhatsApp', Icon: FaWhatsapp },
  ];
  const socialItemCls = 'flex items-center justify-center gap-2';
  const socialIconCls = 'w-4 h-4 text-gray-800';
  const socialLabelCls = 'text-xs text-gray-700';

  if (!visible) return null;
  const handleClose = () => {
    setVisible(false);
    onClose?.();
  };
  return (
    <div
      className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 sm:p-6'
      onClick={handleClose}
    >
      <div
        className='bg-white rounded-lg shadow-xl w-full max-w-md mx-4 sm:mx-0 overflow-hidden'
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className='p-4 sm:p-6 border-b border-gray-200'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center space-x-3'>
              <div className='min-w-0 flex-1'>
                <h2 className='text-base sm:text-lg font-semibold text-gray-900 truncate'>
                  {headerTitle}
                </h2>
                <p className='text-xs sm:text-sm text-gray-600'>
                  {headerSubtitle}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className='text-indigo-600 hover:text-indigo-700 border border-indigo-200 px-3 py-1 rounded-md text-xs sm:text-sm'
            >
              Fermer
            </button>
          </div>
        </div>

        {/* Contenu principal */}
        <div className='p-4 sm:p-6 space-y-4'>
          <p className='text-xs sm:text-sm text-gray-700 font-medium text-center'>
            {helperText}
          </p>
          {/* Lien à copier */}
          <div className='space-y-3'>
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
                {!copied && <Copy size={12} className='sm:w-3.5 sm:h-3.5' />}
                <span>{copied ? 'Copié' : 'Copier'}</span>
              </button>
            </div>
          </div>

          {/* Réseaux sociaux */}
          <div className='space-y-2'>
            <div className='grid grid-cols-2 sm:grid-cols-5 gap-y-3 gap-x-4 sm:gap-x-5 place-items-center'>
              {socials.map(({ label, Icon }) => (
                <div key={label} className={socialItemCls}>
                  <span className='inline-flex items-center justify-center'>
                    <Icon className={socialIconCls} />
                  </span>
                  <span className={socialLabelCls}>{label}</span>
                </div>
              ))}
            </div>
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
