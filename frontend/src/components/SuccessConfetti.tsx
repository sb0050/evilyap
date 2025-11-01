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
  shareLink = "https://paylive.cc/c/example"
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (show) {
      // Effet de confettis plus subtil et professionnel
      const duration = 2000;
      const animationEnd = Date.now() + duration;

      const interval: any = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 20 * (timeLeft / duration);
        
        // Confettis subtils depuis le centre
        confetti({
          particleCount,
          startVelocity: 15,
          spread: 45,
          origin: { x: 0.5, y: 0.3 },
          colors: ['#4f46e5', '#6366f1', '#8b5cf6'],
          ticks: 40,
          gravity: 0.8,
          scalar: 0.8
        });
      }, 400);

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header simple et professionnel */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                <span className="text-indigo-600 text-xl">✓</span>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Boutique créée</h2>
                <p className="text-sm text-gray-600">Votre boutique est maintenant en ligne</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Contenu principal */}
        <div className="p-6 space-y-4">
          {/* Section de partage de lien */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-gray-700">
              <ExternalLink size={16} />
              <span className="text-sm font-medium">Lien de votre boutique</span>
            </div>
            
            <div className="flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-md p-3">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 bg-transparent text-sm text-gray-700 outline-none"
              />
              <button
                onClick={handleCopy}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  copied 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copié' : 'Copier'}</span>
              </button>
            </div>
          </div>

          {/* Message d'encouragement */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-md p-4">
            <p className="text-sm text-indigo-700">
              Partagez ce lien avec vos clients pour qu'ils puissent effectuer des paiements directement sur votre boutique.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Commencer à utiliser ma boutique
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuccessConfetti;