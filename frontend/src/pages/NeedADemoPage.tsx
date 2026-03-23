import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import Spinner from '../components/Spinner';
import { API_BASE_URL } from '../utils/api';

type MyStoreResp = {
  success?: boolean;
  hasStore?: boolean;
  store?: {
    id?: number;
    name?: string;
    slug?: string;
    clerk_id?: string;
  } | null;
  error?: string;
};

export default function NeedADemoPage() {
  const navigate = useNavigate();
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [contactMethod, setContactMethod] = useState<'phone' | 'email'>(
    'phone'
  );
  const [phoneInput, setPhoneInput] = useState<string | undefined>(undefined);
  const [emailInput, setEmailInput] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const isPhoneValid = Boolean(phoneInput && isValidPhoneNumber(phoneInput));
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput);
  const isContactValid =
    contactMethod === 'phone' ? isPhoneValid : Boolean(isEmailValid);

  const sendNeedADemo = useCallback(
    async (options: {
      trigger: 'manual_recontact';
      contactMethod: 'phone' | 'email';
      phoneE164?: string | null;
      phoneRaw?: string | null;
      contactEmail?: string | null;
    }) => {
      try {
        const token = (await getToken()) || '';
        const post = await fetch(`${API_BASE_URL}/api/stores/need-a-demo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({
            source: 'needademo',
            trigger: options.trigger,
            contactMethod: options.contactMethod,
            phone: options.phoneE164 || null,
            phoneRaw: options.phoneRaw || null,
            contactEmail: options.contactEmail || null,
          }),
        });
        if (!post.ok) {
          const json = await post.json().catch(() => null as any);
          throw new Error(
            String(json?.error || "Erreur lors de l'envoi de la demande")
          );
        }
        setRequested(true);
        return true;
      } catch (e: any) {
        setError(String(e?.message || 'Erreur interne'));
        return false;
      }
    },
    [getToken]
  );

  useEffect(() => {
    if (!isLoaded) return;

    const run = async () => {
      setLoading(true);
      setError(null);
      let keepSpinner = false;

      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE_URL}/api/stores/me`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        });
        const json = (await resp
          .json()
          .catch(() => null)) as MyStoreResp | null;

        if (resp.ok && json?.hasStore) {
          keepSpinner = true;
          navigate('/dashboard', { replace: true });
          return;
        }
      } catch (e: any) {
        setError(String(e?.message || 'Erreur interne'));
      } finally {
        if (!keepSpinner) setLoading(false);
      }
    };

    run();
  }, [isLoaded, getToken, navigate]);

  useEffect(() => {
    const primary = String(
      (user as any)?.primaryEmailAddress?.emailAddress ||
        user?.emailAddresses?.[0]?.emailAddress ||
        ''
    ).trim();
    if (!emailInput && primary) {
      setEmailInput(primary);
    }
  }, [user, emailInput]);

  const handleManualRequest = async () => {
    if (sending || requested) return;
    setError(null);
    const rawPhone = String(phoneInput || '').trim();
    const rawEmail = String(emailInput || '').trim();
    if (contactMethod === 'phone') {
      if (!isPhoneValid) {
        setPhoneError(
          'Numéro invalide. Format attendu: numéro français valide.'
        );
        return;
      }
      setPhoneError(null);
    } else if (!isEmailValid) {
      setError('Email invalide');
      return;
    }
    setSending(true);
    const ok = await sendNeedADemo({
      trigger: 'manual_recontact',
      contactMethod,
      phoneE164: contactMethod === 'phone' ? rawPhone : null,
      phoneRaw: contactMethod === 'phone' ? rawPhone : null,
      contactEmail: contactMethod === 'email' ? rawEmail : null,
    });
    if (!ok) {
      setSending(false);
      return;
    }
    setSending(false);
  };

  if (loading) {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <Spinner />
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-2xl mx-auto px-4 py-10'>
        <div className='bg-white rounded-lg shadow p-6'>
          <h1 className='text-2xl font-bold text-gray-900 mb-2'>
            Demande de démo
          </h1>
          {error ? (
            <div className='text-red-600 text-sm'>{error}</div>
          ) : (
            <div className='space-y-3 text-gray-700'>
              <p>
                Merci{user?.firstName ? ` ${user.firstName}` : ''}, on va te
                recontacter très vite pour une démo.
              </p>
              <div className='space-y-2'>
                <p className='text-sm font-medium text-gray-700'>
                  Comment souhaites-tu être recontacté ?
                </p>
                <label className='inline-flex items-center mr-4 text-sm'>
                  <input
                    type='radio'
                    name='needademo-contact-method'
                    value='phone'
                    checked={contactMethod === 'phone'}
                    onChange={() => setContactMethod('phone')}
                    disabled={requested}
                    className='mr-2'
                  />
                  Téléphone
                </label>
                <label className='inline-flex items-center text-sm'>
                  <input
                    type='radio'
                    name='needademo-contact-method'
                    value='email'
                    checked={contactMethod === 'email'}
                    onChange={() => setContactMethod('email')}
                    disabled={requested}
                    className='mr-2'
                  />
                  E-mail
                </label>
              </div>
              {contactMethod === 'phone' ? (
                <div>
                  <label
                    htmlFor='needademo-phone'
                    className='block text-sm font-medium text-gray-700 mb-1'
                  >
                    Numéro de téléphone (France par défaut)
                  </label>
                  <PhoneInput
                    id='needademo-phone'
                    value={phoneInput}
                    onChange={setPhoneInput}
                    placeholder='Entrez votre numéro'
                    defaultCountry='FR'
                    disabled={requested}
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500'
                  />
                  {phoneError ? (
                    <p className='text-xs text-red-600 mt-1'>{phoneError}</p>
                  ) : null}
                </div>
              ) : (
                <div>
                  <label
                    htmlFor='needademo-email'
                    className='block text-sm font-medium text-gray-700 mb-1'
                  >
                    E-mail de contact
                  </label>
                  <input
                    id='needademo-email'
                    type='email'
                    value={emailInput}
                    onChange={e => setEmailInput(e.target.value)}
                    disabled={requested}
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500'
                  />
                </div>
              )}
              <button
                type='button'
                onClick={handleManualRequest}
                disabled={requested || sending || !isContactValid}
                className='inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed'
              >
                {sending ? 'Envoi…' : 'Être recontacté'}
              </button>
              <p className='text-sm text-gray-500'>
                {requested
                  ? 'Ta demande a bien été transmise.'
                  : 'Clique sur le bouton pour nous envoyer ta demande de rappel.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
