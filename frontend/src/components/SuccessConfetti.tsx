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
