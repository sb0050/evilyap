import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import { Upload } from 'lucide-react';
import { AddressElement } from '@stripe/react-stripe-js';
import { Address } from '@stripe/stripe-js';

import slugify from 'slugify';
import { apiGet, apiPost, apiPostForm } from '../utils/api';
import { Toast } from '../components/Toast';
import { useToast } from '../utils/toast';
import Header from '../components/Header';
import StripeWrapper from '../components/StripeWrapper';

interface OnboardingFormData {
  storeName: string;
  logo: File | null;
  description: string;
  name: string;
  phone: string;
  website?: string;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [onboardingAllowed, setOnboardingAllowed] = useState<boolean | null>(
    null
  );

  // Redirection basée sur le rôle Clerk: ne rien faire pour admin, rediriger vers dashboard si rôle != 'customer'
  useEffect(() => {
    const role = (user?.publicMetadata as any)?.role;
    if (!role || role === 'admin') return;
    if (role !== 'customer') {
      const email = user?.primaryEmailAddress?.emailAddress;
      if (!email) return;
      (async () => {
        try {
          const response = await fetch(
            `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stores/check-owner/${encodeURIComponent(email)}`
          );
          if (!response.ok) return;
          const data = await response.json();
          if (data?.exists) {
            const storeSlug =
              data.slug ||
              (data.storeName
                ? slugify(data.storeName, { lower: true, strict: true })
                : undefined);
            if (storeSlug) {
              window.location.href = `/dashboard/${encodeURIComponent(storeSlug)}`;
            }
          }
        } catch (_err) {
          // Ignorer silencieusement; onboarding reste accessible
        }
      })();
    }
  }, [user]);

  // Préremplir le nom complet depuis Clerk
  useEffect(() => {
    const fullName = user?.fullName || '';
    if (fullName && !formData.name) {
      setFormData(prev => ({ ...prev, name: fullName }));
    }
  }, [user?.fullName]);

  // Garde d'onboarding (fallback): ne pas afficher le contenu tant que la vérification n'est pas faite
  useEffect(() => {
    const check = async () => {
      const email = user?.primaryEmailAddress?.emailAddress;
      // Si Clerk charge ou pas d'email, rester en pending
      if (!email) {
        setOnboardingAllowed(null);
        return;
      }
      try {
        const resp = await fetch(
          `${(import.meta as any).env.VITE_API_URL || 'http://localhost:5000'}/api/stores/check-owner/${encodeURIComponent(email)}`
        );
        const json = await resp.json();
        if (json?.exists && json?.slug) {
          window.location.href = `/dashboard/${encodeURIComponent(json.slug)}`;
          return;
        }
        setOnboardingAllowed(true);
      } catch (_e) {
        // En cas d'erreur, laisser l'overlay du Header afficher l'erreur
        setOnboardingAllowed(false);
      }
    };
    check();
  }, [user?.primaryEmailAddress?.emailAddress]);

  const { toast, showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<OnboardingFormData>({
    storeName: '',
    logo: null,
    description: '',
    name: '',
    phone: '',
    website: '',
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [slugExists, setSlugExists] = useState(false);
  const [generatedSlug, setGeneratedSlug] = useState('');
  const [wasStoreNameFocused, setWasStoreNameFocused] = useState(false);
  const [isStoreNameDirty, setIsStoreNameDirty] = useState(false);
  const [lastCheckedSlug, setLastCheckedSlug] = useState('');
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // États pour l'adresse Stripe
  const [billingAddress, setBillingAddress] = useState<Address | null>(null);
  const [isAddressComplete, setIsAddressComplete] = useState(false);

  // Validation du site web
  const isValidWebsite = (url: string) => {
    const value = (url || '').trim();
    if (!value) return true; // champ facultatif

    // Cas 1: nom de domaine sans protocole, doit terminer par un TLD (ex: .co, .cc, .it, etc.)
    const domainOnlyRegex = /^(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,}$/;
    if (domainOnlyRegex.test(value)) return true;

    // Cas 2: URL complète avec protocole (on l'accepte également)
    try {
      const parsed = new URL(value);
      const host = parsed.hostname || '';
      const hasTld = /\.[a-zA-Z]{2,}$/.test(host);
      return hasTld; // on ne force pas http/https, on vérifie seulement que le host a un TLD
    } catch {
      return false;
    }
  };
  const websiteInvalid = !!(
    formData.website && !isValidWebsite(formData.website)
  );

  // Debug: tracer les raisons du disabled du bouton
  useEffect(() => {
    const disabled =
      loading ||
      !formData.storeName.trim() ||
      slugExists ||
      !isAddressComplete ||
      !formData.name.trim() ||
      !formData.phone.trim();
  }, [
    loading,
    formData.storeName,
    slugExists,
    isAddressComplete,
    formData.name,
    formData.phone,
    billingAddress,
  ]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedMimes = ['image/png', 'image/jpeg'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowedExts = ['png', 'jpg', 'jpeg'];
    const isMimeOk = allowedMimes.includes(file.type);
    const isExtOk = !!ext && allowedExts.includes(ext);

    if (!isMimeOk && !isExtOk) {
      showToast('Format de logo invalide. Utilisez PNG ou JPG/JPEG.', 'error');
      return;
    }

    setFormData({ ...formData, logo: file });
    const reader = new FileReader();
    reader.onload = e => {
      setLogoPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowValidationErrors(true);

    // Champs obligatoires
    if (!formData.storeName.trim()) {
      return;
    }
    if (!formData.logo) {
      return;
    }

    if (!user?.primaryEmailAddress?.emailAddress) {
      showToast('Erreur: Email utilisateur non trouvé', 'error');
      return;
    }

    // Vérifier que l'adresse est complète
    if (!isAddressComplete || !formData.name.trim() || !formData.phone.trim()) {
      showToast(
        'Veuillez compléter toutes les informations de facturation',
        'error'
      );
      return;
    }

    // Vérifier le format du site web s'il est fourni
    if (formData.website && !isValidWebsite(formData.website)) {
      showToast(
        'Veuillez saisir un nom de domaine valide (ex: votre-site.co) ou une URL complète',
        'error'
      );
      return;
    }

    setLoading(true);
    console.log('Submitting form with data:', {
      storeName: formData.storeName,
      description: formData.description,
      logoPresent: !!formData.logo,
      isAddressComplete,
      name: formData.name,
      phone: formData.phone,
      website: formData.website,
      billingAddress,
    });
    try {
      const slug =
        generatedSlug ||
        slugify(formData.storeName, { lower: true, strict: true });

      const response = await apiPost('/api/stores', {
        storeName: formData.storeName,
        storeDescription: formData.description,
        ownerEmail: user.primaryEmailAddress.emailAddress,
        slug,
        // Données de facturation pour créer le client Stripe
        clerkUserId: user.id,
        name: formData.name,
        phone: formData.phone,
        address: billingAddress,
        website: formData.website || undefined,
      });

      const result = await response.json();

      if (response.ok) {
        console.log('Store created successfully:', result);
        // Uploader le logo après la création pour utiliser l'id immuable
        if (formData.logo && result?.store?.slug) {
          try {
            const fd = new FormData();
            fd.append('image', formData.logo);
            fd.append('slug', result.store.slug);
            const uploadResp = await apiPostForm('/api/upload', fd);
            const uploadJson = await uploadResp.json();
            if (!uploadJson?.success) {
              console.warn('Upload du logo échoué:', uploadJson?.error);
            }
          } catch (err) {
            console.warn("Erreur lors de l'upload du logo:", err);
          }
        }
        // rediriger vers le tableau de bord de la boutique avec le slug renvoyé par le backend
        const finalSlug = result?.store?.slug || slug;
        navigate(`/dashboard/${encodeURIComponent(finalSlug)}`, {
          state: { isStorecreated: true },
        });
      } else {
        throw new Error(
          result.error || 'Erreur lors de la création de la boutique'
        );
      }
    } catch (error) {
      console.error('Erreur lors de la création de la boutique:', error);
      showToast(
        error instanceof Error
          ? error.message
          : 'Erreur lors de la création de la boutique',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleStoreNameFocus = () => {
    setWasStoreNameFocused(true);
  };

  const handleStoreNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData({ ...formData, storeName: value });
    setIsStoreNameDirty(true);
    // Reset slugExists pour éviter un disabled persistant
    if (slugExists) setSlugExists(false);
  };

  const handleStoreNameBlur = async () => {
    const name = formData.storeName.trim();
    if (!name) {
      console.log('storeName blur: empty');
      setShowValidationErrors(true);
      setWasStoreNameFocused(false);
      return;
    }
    if (!wasStoreNameFocused) {
      setWasStoreNameFocused(false);
      return;
    }
    if (!isStoreNameDirty) {
      setWasStoreNameFocused(false);
      return;
    }
    const slug = slugify(name, { lower: true, strict: true });
    if (lastCheckedSlug === slug) {
      setWasStoreNameFocused(false);
      setIsStoreNameDirty(false);
      return;
    }
    await checkSlugUniqueness();
    setWasStoreNameFocused(false);
    setIsStoreNameDirty(false);
  };

  const checkSlugUniqueness = async () => {
    const name = formData.storeName.trim();
    if (!name) return;
    const slug = slugify(name, { lower: true, strict: true });
    setGeneratedSlug(slug);
    setIsCheckingSlug(true);
    try {
      const resp = await apiGet(
        `/api/stores/exists?slug=${encodeURIComponent(slug)}`
      );
      if (!resp.ok) throw new Error('Erreur lors de la vérification du slug');
      const json = await resp.json();
      setSlugExists(Boolean(json?.exists));
      setLastCheckedSlug(slug);
    } catch (err) {
      console.error('Vérification du slug échouée:', err);
      setSlugExists(false);
    } finally {
      setIsCheckingSlug(false);
    }
  };

  // Masquer le contenu tant que la garde n'est pas 'ok' (pending ou erreur -> Header affiche overlay)
  if (onboardingAllowed !== true) {
    return (
      <div className='min-h-screen bg-gray-50'>
        <Header />
      </div>
    );
  }

  // Toast notifications rendered when present

  return (
    <div className='min-h-screen bg-gray-50'>
      <Header />
      <div className='py-12 px-4 sm:px-6 lg:px-8'>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            visible={(toast as any).visible !== false}
          />
        )}
        <div className='max-w-2xl mx-auto'>
          <div className='text-center mb-8'>
            <img
              src='/logo_paylive.png'
              alt='PayLive'
              className='mx-auto h-12 w-auto'
            />
            <h1 className='mt-4 text-3xl font-bold text-gray-900'>
              Créez votre boutique
            </h1>
            <p className='mt-2 text-gray-600'>
              Bienvenue {user?.firstName} ! Configurons votre nouvelle boutique
              en ligne.
            </p>
          </div>

          <div className='bg-white shadow-lg rounded-lg p-8'>
            <form onSubmit={handleSubmit} className='space-y-6'>
              {/* Nom de la boutique */}
              <div>
                <label
                  htmlFor='storeName'
                  className='block text-sm font-medium text-gray-700 mb-2'
                >
                  Nom de votre boutique *
                </label>
                <div className='relative'>
                  <input
                    type='text'
                    id='storeName'
                    required
                    value={formData.storeName}
                    onChange={handleStoreNameChange}
                    onFocus={handleStoreNameFocus}
                    onBlur={handleStoreNameBlur}
                    className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 
                      ${slugExists || !formData.storeName.trim() ? 'border-red-500' : 'border-gray-300'}`}
                    placeholder='Ma Super Boutique'
                  />
                  {isCheckingSlug && (
                    <div className='absolute right-3 inset-y-0 flex items-center'>
                      <div className='animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-500'></div>
                    </div>
                  )}
                </div>
                {showValidationErrors && !formData.storeName.trim() && (
                  <p className='mt-2 text-sm text-red-600'>
                    Veuillez renseigner le nom de la boutique
                  </p>
                )}
                {slugExists && (
                  <p className='mt-2 text-sm text-red-600'>
                    Ce nom existe déjà.
                  </p>
                )}
              </div>

              {/* Description/Slogan */}
              <div>
                <label
                  htmlFor='description'
                  className='block text-sm font-medium text-gray-700 mb-2'
                >
                  Description ou slogan (facultatif)
                </label>
                <textarea
                  id='description'
                  rows={3}
                  value={formData.description}
                  onChange={e =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'
                  placeholder='Décrivez votre boutique en quelques mots...'
                />
              </div>

              {/* Site web (facultatif) */}
              <div>
                <label
                  htmlFor='website'
                  className='block text-sm font-medium text-gray-700 mb-2'
                >
                  Site web (facultatif)
                </label>
                <input
                  id='website'
                  value={formData.website || ''}
                  onChange={e =>
                    setFormData({ ...formData, website: e.target.value })
                  }
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${formData.website && websiteInvalid ? 'border-red-500' : 'border-gray-300'}`}
                  placeholder='https://votre-site.com'
                />
                {formData.website && websiteInvalid && (
                  <p className='mt-2 text-sm text-red-600'>
                    Veuillez saisir un nom de domaine valide (ex: votre-site.co)
                    ou une URL complète
                  </p>
                )}
              </div>

              {/* Logo */}
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-2'>
                  Logo de votre boutique *
                </label>
                <div className='flex items-center space-x-4'>
                  <div className='flex-1'>
                    <label
                      className={`flex flex-col items-center justify-center w-full h-32 border-2 
                        ${slugExists || !formData.logo ? 'border-red-500' : 'border-gray-300'} border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100`}
                    >
                      <div className='flex flex-col items-center justify-center pt-5 pb-6'>
                        <Upload className='w-8 h-8 mb-2 text-gray-400' />
                        <p className='text-sm text-gray-500'>
                          Cliquez pour télécharger un logo
                        </p>
                      </div>
                      <input
                        type='file'
                        className='hidden'
                        accept='image/png, image/jpeg'
                        required
                        onChange={handleLogoChange}
                      />
                    </label>
                  </div>
                  {logoPreview && (
                    <div className='w-32 h-32 border rounded-lg overflow-hidden'>
                      <img
                        src={logoPreview}
                        alt='Aperçu du logo'
                        className='w-full h-full object-cover'
                      />
                    </div>
                  )}
                </div>
                {!formData.logo && showValidationErrors && (
                  <p className='mt-2 text-sm text-red-600'>
                    Veuillez ajouter un logo
                  </p>
                )}
              </div>

              {/* Informations de facturation */}
              {/* Adresse avec Stripe AddressElement */}
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-2'>
                  Adresse de la boutique *
                </label>
                <StripeWrapper>
                  <div
                    className={`rounded-md border ${!isAddressComplete ? 'border-red-500' : 'border-gray-300'} p-2`}
                  >
                    <AddressElement
                      key={user?.id || 'nouser'}
                      options={{
                        mode: 'billing',
                        allowedCountries: ['FR'],
                        fields: {
                          phone: 'always',
                        },
                        validation: {
                          phone: {
                            required: 'always', // Rend le champ téléphone obligatoire
                          },
                        },
                        defaultValues: {
                          name: user?.fullName || formData.name,
                          phone: formData.phone,
                        },
                      }}
                      onChange={event => {
                        setIsAddressComplete(event.complete);
                        if (event.value.address) {
                          setBillingAddress(event.value.address);
                        }
                        // Mettre à jour le nom et téléphone si fournis par AddressElement
                        if (event.value.name) {
                          setFormData(prev => ({
                            ...prev,
                            name: event.value.name as string,
                          }));
                        }
                        if (event.value.phone) {
                          setFormData(prev => ({
                            ...prev,
                            phone: event.value.phone as string,
                          }));
                        }
                      }}
                    />
                  </div>
                  {!isAddressComplete && (
                    <p className='mt-2 text-sm text-red-600'>
                      Veuillez compléter votre adresse
                    </p>
                  )}
                </StripeWrapper>
              </div>

              {/* Bouton de soumission */}
              <button
                type='submit'
                disabled={
                  loading ||
                  !formData.storeName.trim() ||
                  slugExists ||
                  !isAddressComplete ||
                  !formData.name.trim() ||
                  !formData.phone.trim() ||
                  (formData.website ? websiteInvalid : false)
                }
                onMouseEnter={() => {
                  const disabled =
                    loading ||
                    !formData.storeName.trim() ||
                    slugExists ||
                    !isAddressComplete ||
                    !formData.name.trim() ||
                    !formData.phone.trim() ||
                    (formData.website ? websiteInvalid : false);
                }}
                className='w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              >
                {loading ? 'Création en cours...' : 'Créer ma boutique'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
