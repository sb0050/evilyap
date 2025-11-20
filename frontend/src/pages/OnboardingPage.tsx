import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUser, useAuth } from '@clerk/clerk-react';
import { Store, Upload, BadgeCheck } from 'lucide-react';
import { AddressElement } from '@stripe/react-stripe-js';
import { Address } from '@stripe/stripe-js';

import slugify from 'slugify';
import { apiGet, apiPost, apiPostForm } from '../utils/api';
import { Toast } from '../components/Toast';
import { useToast } from '../utils/toast';
import Header from '../components/Header';
import StripeWrapper from '../components/StripeWrapper';
import { FR, BE } from 'country-flag-icons/react/3x2';

interface OnboardingFormData {
  storeName: string;
  logo: File | null;
  description: string;
  name: string;
  phone: string;
  website?: string;
  siret: string;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { getToken } = useAuth();
  // Accès et redirections sont centralisés dans Header

  // (Supprimé) redirections/guards locaux pour éviter la redondance

  // Préremplir le nom complet depuis Clerk
  useEffect(() => {
    const fullName = user?.fullName || '';
    if (fullName && !formData.name) {
      setFormData(prev => ({ ...prev, name: fullName }));
    }
  }, [user?.fullName]);

  // (Supprimé) garde fallback; Header gère l'accès et les overlays

  const { toast, showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(null);
  const [formData, setFormData] = useState<OnboardingFormData>({
    storeName: '',
    logo: null,
    description: '',
    name: '',
    phone: '',
    website: '',
    siret: '',
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [slugExists, setSlugExists] = useState(false);
  const [generatedSlug, setGeneratedSlug] = useState('');
  const [wasStoreNameFocused, setWasStoreNameFocused] = useState(false);
  const [isStoreNameDirty, setIsStoreNameDirty] = useState(false);
  const [lastCheckedSlug, setLastCheckedSlug] = useState('');
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  // États pour la vérification SIRET via INSEE
  const [isCheckingSiret, setIsCheckingSiret] = useState(false);
  const [siretErrorMessage, setSiretErrorMessage] = useState('');
  const [wasSiretFocused, setWasSiretFocused] = useState(false);
  const [isSiretDirty, setIsSiretDirty] = useState(false);
  const [lastCheckedSiret, setLastCheckedSiret] = useState('');
  const [siretDetails, setSiretDetails] = useState<any | null>(null);
  const [companyCountry, setCompanyCountry] = useState<'FR' | 'BE'>('FR');

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

  // Validation SIRET (basique: 14 chiffres)
  const isValidSiret = (value: string) => {
    const digits = (value || '').replace(/\s+/g, '');
    return /^\d{14}$/.test(digits);
  };
  const isValidBce = (value: string) => {
    const digits = (value || '')
      .replace(/\s+/g, '')
      .replace(/^BE/i, '')
      .replace(/\./g, '');
    return /^\d{10}$/.test(digits);
  };
  const normalizeCompanyId = (value: string) => {
    const v = (value || '').trim();
    if (companyCountry === 'FR') return v.replace(/\s+/g, '');
    return v.replace(/\s+/g, '').replace(/^BE/i, '').replace(/\./g, '');
  };
  // SIRET facultatif: invalide uniquement si non vide et format incorrect
  const siretInvalid = formData.siret
    ? companyCountry === 'FR'
      ? !isValidSiret(formData.siret)
      : !isValidBce(formData.siret)
    : false;

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

    // SIRET est facultatif: si fourni, il doit être valide et connu
    if (formData.siret && (siretInvalid || !!siretErrorMessage)) {
      showToast('Veuillez saisir un SIRET valide (14 chiffres)', 'error');
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
    // Empêcher la redirection automatique du Header pendant les opérations post-création
    try {
      navigate('/onboarding', {
        replace: true,
        state: { skipOnboardingRedirect: true },
      });
    } catch (_e) {
      // ignore
    }

    // Conserver l'ID Stripe obtenu localement pour l'utiliser immédiatement
    let createdStripeId: string | null = null;
    try {
      // Créer (ou récupérer) le client Stripe avant la création de la boutique
      try {
        const token = await getToken();
        const createResp = await apiPost(
          '/api/stripe/create-customer',
          {
            name: formData.name || user?.fullName || '',
            email: user?.primaryEmailAddress?.emailAddress,
            clerkUserId: user?.id,
          },
          {
            headers: {
              Authorization: token ? `Bearer ${token}` : '',
            },
          }
        );
        const createdJson = await createResp.json().catch(() => ({}));
        createdStripeId =
          createdJson?.stripeId || createdJson?.customer?.id || null;
        if (createdStripeId) {
          setStripeCustomerId(createdStripeId);
        }
      } catch (e) {
        console.warn('Création du client Stripe échouée (continuation):', e);
      }

      const slug =
        generatedSlug ||
        slugify(formData.storeName, { lower: true, strict: true });
      // Utiliser l'ID local si l'état React n'est pas encore mis à jour
      const stripeIdToUse = createdStripeId || stripeCustomerId || undefined;

      const isSiretVerified =
        Boolean(formData.siret) &&
        lastCheckedSiret === formData.siret &&
        !siretInvalid &&
        !siretErrorMessage &&
        !!siretDetails;

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
        siret: formData.siret || undefined,
        is_verified: isSiretVerified,
        stripeCustomerId: stripeIdToUse,
      });

      const result = await response.json();

      if (response.ok) {
        // Rafraîchir les métadonnées Clerk (rôle/stripe_id) côté client
        try {
          const clerkUser = user as any;
          if (clerkUser && typeof clerkUser.reload === 'function') {
            await clerkUser.reload();
          }
        } catch (reloadErr) {
          console.warn('Échec du rafraîchissement de Clerk user:', reloadErr);
        }

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

        // Rediriger vers le tableau de bord (sans slug) et afficher le welcome
        navigate(`/dashboard`, {
          state: { isStorecreated: true },
        });
      } else {
        throw new Error(
          result.error || 'Erreur lors de la création de la boutique'
        );
      }
    } catch (error) {
      // Lever le flag pour permettre au Header de reprendre la main
      try {
        navigate('/onboarding', { replace: true, state: undefined });
      } catch (_e) {
        // ignore
      }
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

  // Gestion du champ SIRET (focus/change/blur)
  const handleSiretFocus = () => {
    setWasSiretFocused(true);
  };

  const handleSiretChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\s+/g, '');
    setFormData(prev => ({ ...prev, siret: value }));
    setIsSiretDirty(true);
    setSiretDetails(null);
    // Réinitialiser le message d'erreur lors de la saisie
    if (!value) {
      setSiretErrorMessage('');
      setLastCheckedSiret('');
      setSiretDetails(null);
    } else if (siretErrorMessage) {
      setSiretErrorMessage('');
    }
  };

  const handleSiretBlur = async () => {
    const raw = (formData.siret || '').trim();
    if (!wasSiretFocused) {
      setWasSiretFocused(false);
      return;
    }
    if (!isSiretDirty) {
      setWasSiretFocused(false);
      return;
    }
    // SIRET facultatif: si vide, ne rien vérifier
    if (!raw) {
      setSiretErrorMessage('');
      setSiretDetails(null);
      setWasSiretFocused(false);
      setIsSiretDirty(false);
      return;
    }
    if (companyCountry === 'FR') {
      const siret = raw.replace(/\s+/g, '');
      if (!/^\d{14}$/.test(siret)) {
        setShowValidationErrors(true);
        setSiretErrorMessage(
          'Erreur de format de siret (Format attendu : 14 chiffres)'
        );
        setSiretDetails(null);
        setWasSiretFocused(false);
        setIsSiretDirty(false);
        return;
      }
    } else {
      const bce = raw
        .replace(/\s+/g, '')
        .replace(/^BE/i, '')
        .replace(/\./g, '');
      if (!/^\d{10}$/.test(bce)) {
        setShowValidationErrors(true);
        setSiretErrorMessage(
          'Erreur de format de BCE (Format attendu : 10 chiffres)'
        );
        setSiretDetails(null);
        setWasSiretFocused(false);
        setIsSiretDirty(false);
        return;
      }
    }
    // Revalider au blur si l’utilisateur a modifié la valeur
    await checkSiretValidity();
    setWasSiretFocused(false);
    setIsSiretDirty(false);
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

  const checkSiretValidity = async () => {
    const normalized = normalizeCompanyId(formData.siret || '');
    if (!normalized) return;
    if (companyCountry === 'FR' && !/^\d{14}$/.test(normalized)) return;
    if (companyCountry === 'BE' && !/^\d{10}$/.test(normalized)) return;
    setIsCheckingSiret(true);
    try {
      const endpoint = companyCountry === 'FR' ? 'siret' : 'bce';
      const resp = await apiGet(
        `/api/insee-bce/${endpoint}/${encodeURIComponent(normalized)}`
      );
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json?.success) {
        setSiretErrorMessage('');
        setLastCheckedSiret(normalized);
        setSiretDetails(json?.data || null);
      } else {
        const message =
          json?.header?.message ||
          json?.error ||
          (companyCountry === 'FR'
            ? 'SIRET invalide ou introuvable'
            : 'BCE invalide ou introuvable');
        setSiretErrorMessage(message);
        setLastCheckedSiret(normalized);
        setSiretDetails(null);
      }
    } catch (err) {
      console.error('Vérification SIRET/BCE échouée:', err);
      setSiretErrorMessage(
        companyCountry === 'FR'
          ? 'Erreur lors de la vérification du SIRET'
          : 'Erreur lors de la vérification du BCE'
      );
      setSiretDetails(null);
    } finally {
      setIsCheckingSiret(false);
    }
  };

  // Le contenu est affiché; Header gère les redirections et overlays

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
            <Link to='/'>
              <img
                src='/logo_paylive.png'
                alt='PayLive'
                className='mx-auto h-12 w-auto'
              />
            </Link>
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

              {/* SIRET/BCE */}
              <div>
                <label
                  htmlFor='siret'
                  className='block text-sm font-medium text-gray-700 mb-2'
                >
                  {companyCountry === 'FR'
                    ? 'SIRET (14 chiffres, facultatif mais nécessaire pour obtenir le badge "boutique vérifiée")'
                    : 'BCE (10 chiffres, facultatif mais nécessaire pour obtenir le badge "boutique vérifiée")'}
                </label>
                <div className='flex items-center gap-2'>
                  <div className='relative flex-1'>
                    <input
                      id='siret'
                      inputMode='numeric'
                      value={formData.siret}
                      onChange={handleSiretChange}
                      onFocus={handleSiretFocus}
                      onBlur={handleSiretBlur}
                      className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${showValidationErrors && (siretInvalid || !!siretErrorMessage) ? 'border-red-500' : 'border-gray-300'}`}
                      placeholder={
                        companyCountry === 'FR'
                          ? '12345678901234'
                          : '0123.456.789 ou BE0123456789'
                      }
                    />
                    {isCheckingSiret && (
                      <div className='absolute right-3 inset-y-0 flex items-center'>
                        <div className='animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-500'></div>
                      </div>
                    )}
                  </div>
                </div>
                {(formData.siret && showValidationErrors && siretInvalid) ||
                (formData.siret && !!siretErrorMessage) ? (
                  <p className='mt-2 text-sm text-red-600'>
                    {siretErrorMessage ||
                      (companyCountry === 'FR'
                        ? 'SIRET invalide. Entrez exactement 14 chiffres.'
                        : 'BCE invalide. Entrez exactement 10 chiffres.')}
                  </p>
                ) : null}

                {formData.siret &&
                normalizeCompanyId(formData.siret) === lastCheckedSiret &&
                !siretInvalid &&
                !siretErrorMessage &&
                siretDetails
                  ? (() => {
                      if (companyCountry === 'FR') {
                        const pick = (v: any) => {
                          if (v === null || v === undefined) return null;
                          const s = String(v).trim();
                          if (!s || s === '[ND]') return null;
                          return s;
                        };
                        const formatInseeDate = (iso: any) => {
                          const s = pick(iso);
                          if (!s) return null;
                          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
                          if (!m) return null;
                          const months = [
                            'Janvier',
                            'Février',
                            'Mars',
                            'Avril',
                            'Mai',
                            'Juin',
                            'Juillet',
                            'Août',
                            'Septembre',
                            'Octobre',
                            'Novembre',
                            'Décembre',
                          ];
                          const year = m[1];
                          const monthIndex = parseInt(m[2], 10) - 1;
                          const day = m[3];
                          const monthName = months[monthIndex] || '';
                          if (!monthName) return null;
                          return `${day} ${monthName} ${year}`;
                        };
                        const d = siretDetails;
                        const e =
                          d?.etablissement || d?.etablissements?.[0] || d;
                        const ul = d?.uniteLegale || e?.uniteLegale || null;
                        const denomination =
                          pick(ul?.denominationUniteLegale) ||
                          pick(ul?.denominationUsuelle1UniteLegale) ||
                          pick(ul?.denominationUsuelle2UniteLegale) ||
                          pick(ul?.denominationUsuelle3UniteLegale) ||
                          pick(e?.enseigne1Etablissement) ||
                          (pick(ul?.prenomUsuelUniteLegale) &&
                          pick(ul?.nomUniteLegale)
                            ? `${pick(ul?.prenomUsuelUniteLegale)} ${pick(ul?.nomUniteLegale)}`
                            : null);
                        const adr =
                          e?.adresseEtablissement ||
                          e?.adressePrincipaleEtablissement ||
                          null;
                        const line1 = [
                          pick(adr?.numeroVoieEtablissement),
                          pick(adr?.typeVoieEtablissement),
                          pick(adr?.libelleVoieEtablissement),
                          pick(adr?.complementAdresseEtablissement),
                        ]
                          .filter(Boolean)
                          .join(' ');
                        const city = [
                          pick(adr?.codePostalEtablissement),
                          pick(adr?.libelleCommuneEtablissement),
                        ]
                          .filter(Boolean)
                          .join(' ');
                        const hasName = !!denomination;
                        const hasAddress = !!line1 || !!city;
                        const hasSiren = !!pick(e?.siren);
                        const creationDateDisplay =
                          formatInseeDate(e?.dateCreationEtablissement) ||
                          formatInseeDate(ul?.dateCreationUniteLegale);
                        const hasDate = !!creationDateDisplay;
                        if (!hasName && !hasAddress) return null;
                        return (
                          <div className='mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700'>
                            <div className='flex items-center gap-2 mb-1 text-gray-800 font-medium'>
                              <BadgeCheck className='w-4 h-4 text-green-600' />
                              Données INSEE vérifiées
                            </div>
                            {hasName && (
                              <div>
                                <span className='text-gray-600'>
                                  Raison sociale:{' '}
                                </span>
                                <span className='font-medium'>
                                  {denomination}
                                </span>
                              </div>
                            )}
                            {hasSiren && (
                              <div className='mt-1'>
                                <span className='text-gray-600'>SIREN: </span>
                                <span className='font-medium'>{e?.siren}</span>
                              </div>
                            )}
                            {hasDate && (
                              <div className='mt-1'>
                                <span className='text-gray-600'>
                                  Date de création:{' '}
                                </span>
                                <span className='font-medium'>
                                  {creationDateDisplay}
                                </span>
                              </div>
                            )}
                            {hasAddress && (
                              <div className='mt-1'>
                                <span className='text-gray-600'>Adresse: </span>
                                <span className='font-medium'>
                                  {[line1, city].filter(Boolean).join(' — ')}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      } else {
                        const data =
                          (siretDetails as any)?.data || siretDetails;
                        const name =
                          (data?.denomination as any) ||
                          (data?.abbreviation as any) ||
                          (data?.commercial_name as any) ||
                          (data?.branch_name as any) ||
                          '';
                        const address =
                          (data?.address?.full_address as any) || '';
                        const cbe =
                          (data?.cbe_number_formatted as any) ||
                          (data?.cbe_number as any) ||
                          '';
                        const start = (data?.start_date as any) || '';
                        const juridic = (data?.juridical_form as any) || '';

                        const hasName = !!String(name).trim();
                        const hasAddress = !!String(address).trim();
                        const hasCbe = !!String(cbe).trim();
                        const hasJuridic = !!String(juridic).trim();
                        const hasStart = !!String(start).trim();
                        if (!hasName && !hasAddress) return null;
                        return (
                          <div className='mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700'>
                            <div className='flex items-center gap-2 mb-1 text-gray-800 font-medium'>
                              <BadgeCheck className='w-4 h-4 text-green-600' />
                              Données BCE vérifiées
                            </div>
                            {hasName && (
                              <div>
                                <span className='text-gray-600'>
                                  Raison sociale:{' '}
                                </span>
                                <span className='font-medium'>{name}</span>
                              </div>
                            )}
                            {hasJuridic && (
                              <div className='mt-1'>
                                <span className='text-gray-600'>
                                  Forme juridique:{' '}
                                </span>
                                <span className='font-medium'>{juridic}</span>
                              </div>
                            )}
                            {hasStart && (
                              <div className='mt-1'>
                                <span className='text-gray-600'>
                                  Date de début:{' '}
                                </span>
                                <span className='font-medium'>{start}</span>
                              </div>
                            )}
                            {hasAddress && (
                              <div className='mt-1'>
                                <span className='text-gray-600'>Adresse: </span>
                                <span className='font-medium'>{address}</span>
                              </div>
                            )}
                          </div>
                        );
                      }
                    })()
                  : null}
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
                  (formData.siret
                    ? siretInvalid || !!siretErrorMessage
                    : false) ||
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
                    (formData.siret
                      ? siretInvalid || !!siretErrorMessage
                      : false) ||
                    (formData.website ? websiteInvalid : false);
                }}
                className='w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              >
                {loading ? (
                  <span className='inline-flex items-center justify-center gap-2'>
                    <span
                      className='h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent'
                      aria-hidden='true'
                    ></span>
                    <span className='text-sm font-medium'>
                      Création en cours…
                    </span>
                  </span>
                ) : (
                  <span className='inline-flex items-center justify-center gap-2'>
                    <Store className='w-5 h-5' aria-hidden='true' />
                    <span className='text-sm font-medium'>
                      Créer ma boutique
                    </span>
                  </span>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
