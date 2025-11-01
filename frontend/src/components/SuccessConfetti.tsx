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
  return;
};

export default SuccessConfetti;
