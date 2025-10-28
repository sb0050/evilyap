import { useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

interface ProtectProps {
  children: React.ReactNode;
}

export default function Protect({ children }: ProtectProps) {
  const { user } = useUser();
  const navigate = useNavigate();

  const role = (user?.publicMetadata as any)?.role;

  useEffect(() => {
    if (!role || role !== 'owner') {
      // Redirige vers l'onboarding si l'utilisateur n'est pas propriétaire
      navigate('/onboarding');
    }
  }, [role, navigate]);

  if (!role || role !== 'owner') {
    // Rendu minimal pendant la redirection
    return null;
  }

  return <>{children}</>;
}