import { useEffect, useState } from 'react';
import {
  RedirectToSignUp,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from '@clerk/clerk-react';
import { Wallet } from 'lucide-react';

type OwnerStoreInfo = {
  exists: boolean;
  storeName?: string;
  ownerEmail?: string;
  slug?: string;
  rib?: string | null;
};

function BalancePanel() {
  const { user } = useUser();
  const [storeInfo, setStoreInfo] = useState<OwnerStoreInfo>({ exists: false });
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const run = async () => {
      const email = user?.primaryEmailAddress?.emailAddress;
      if (!email) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const checkResp = await fetch(
          `${apiBase}/api/stores/check-owner/${encodeURIComponent(email)}`
        );
        const checkJson = await checkResp.json();
        setStoreInfo(checkJson as OwnerStoreInfo);

        const balResp = await fetch(
          `${apiBase}/api/stores/wallet-balance?ownerEmail=${encodeURIComponent(email)}`
        );
        const balJson = await balResp.json();
        if (balResp.ok && balJson?.success) {
          setBalance(balJson.balance || 0);
        }
      } catch (err) {
        setError('Impossible de charger les informations de balance.');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [user]);

  const handleUploadRib = async (file: File) => {
    if (!storeInfo?.slug) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('document', file);
      fd.append('slug', storeInfo.slug);
      const resp = await fetch(`${apiBase}/api/upload/rib`, {
        method: 'POST',
        body: fd,
      });
      const json = await resp.json();
      if (!resp.ok || !json?.success) {
        throw new Error(json?.error || "Échec de l'upload du RIB");
      }
      setStoreInfo(prev => ({ ...prev, rib: json.url }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erreur inconnue lors de l'upload"
      );
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <p className='text-gray-600'>Chargement...</p>;
  }

  if (!storeInfo.exists) {
    return (
      <div className='bg-white shadow rounded p-6'>
        <h2 className='text-xl font-semibold text-gray-900 mb-2'>
          Aucune boutique liée
        </h2>
        <p className='text-gray-600'>
          Votre email n'est pas associé à une boutique. Créez-en une pour
          accéder à la balance.
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='bg-white shadow rounded p-6'>
        <h1 className='text-2xl font-bold text-gray-900 mb-2'>Balance</h1>
        <p className='text-gray-600 mb-4'>
          Boutique: {storeInfo.storeName} ({storeInfo.slug})
        </p>
        <div className='flex items-baseline space-x-2'>
          <span className='text-3xl font-bold text-gray-900'>
            {balance.toFixed(2)}
          </span>
          <span className='text-gray-700'>€ disponibles</span>
        </div>
        <div className='mt-6'>
          <button
            className={`px-4 py-2 rounded-md text-white ${storeInfo.rib ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-400 cursor-not-allowed'}`}
            disabled={!storeInfo.rib}
          >
            Transférer vers le compte bancaire
          </button>
          {!storeInfo.rib && (
            <p className='mt-2 text-sm text-gray-600'>
              Ajoutez votre RIB pour activer les transferts.
            </p>
          )}
        </div>
      </div>

      <div className='bg-white shadow rounded p-6'>
        <h2 className='text-xl font-semibold text-gray-900 mb-2'>RIB</h2>
        {storeInfo.rib ? (
          <div className='text-sm text-gray-700'>
            <p>RIB enregistré:</p>
            <a
              href={storeInfo.rib}
              target='_blank'
              rel='noreferrer'
              className='text-indigo-600 hover:underline'
            >
              {storeInfo.rib}
            </a>
          </div>
        ) : (
          <div>
            <p className='text-sm text-gray-600 mb-4'>
              Uploader votre RIB (PDF, JPG/JPEG, PNG). Il sera stocké sous{' '}
              <code>
                d1tmgyvizond6e.cloudfront.net/documents/slug-nom-de-la-boutique-rib.extension
              </code>
              .
            </p>
            <input
              type='file'
              accept='application/pdf,image/png,image/jpeg'
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                handleUploadRib(file);
              }}
              disabled={uploading}
              className='block w-full text-sm text-gray-700'
            />
            {uploading && (
              <p className='text-sm text-gray-500 mt-2'>Upload en cours...</p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className='bg-red-50 border border-red-200 text-red-700 p-4 rounded'>
          {error}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { user } = useUser();
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const checkOwner = async () => {
      const email = user?.primaryEmailAddress?.emailAddress;
      if (!email) return;
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stores/check-owner/${encodeURIComponent(email)}`
        );
        if (!resp.ok) return;
        const json = await resp.json();
        setIsOwner(Boolean(json?.exists));
      } catch (err) {
        // Silent failure; header remains minimal
      }
    };
    checkOwner();
  }, [user]);

  return (
    <header className='bg-white shadow-sm border-b'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-end items-center h-16'>
          <SignedIn>
            <UserButton userProfileMode='modal'>
              <UserButton.UserProfilePage
                label='Balance'
                url='balance'
                labelIcon={<Wallet className='w-4 h-4' />}
              >
                <BalancePanel />
              </UserButton.UserProfilePage>
              <UserButton.UserProfilePage label='account' />
              <UserButton.UserProfilePage label='security' />
            </UserButton>
          </SignedIn>
          <SignedOut>
            <RedirectToSignUp />
          </SignedOut>
        </div>
      </div>
    </header>
  );
}
