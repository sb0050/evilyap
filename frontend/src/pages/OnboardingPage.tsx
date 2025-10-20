import { useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';

import slugify from 'slugify';
import { apiGet, apiPost, apiPostForm } from '../utils/api';
import { Toast } from '../components/Toast';
import { useToast } from '../utils/toast';

interface OnboardingFormData {
  storeName: string;
  logo: File | null;
  description: string;
}


export default function OnboardingPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<OnboardingFormData>({
    storeName: '',
    logo: null,
    description: '',
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [slugExists, setSlugExists] = useState(false);
  const [generatedSlug, setGeneratedSlug] = useState('');
  const [wasStoreNameFocused, setWasStoreNameFocused] = useState(false);
  const [isStoreNameDirty, setIsStoreNameDirty] = useState(false);
  const [lastCheckedSlug, setLastCheckedSlug] = useState('');

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
    if (!user?.primaryEmailAddress?.emailAddress) {
      showToast('Erreur: Email utilisateur non trouvé', 'error');
      return;
    }

    setLoading(true);
    try {
      const slug =
        generatedSlug ||
        slugify(formData.storeName, { lower: true, strict: true });

      // Uploader le logo si présent
      let logoUrl: string | undefined;
      if (formData.logo) {
        try {
          const fd = new FormData();
          fd.append('image', formData.logo);
          fd.append('slug', slug);
          const uploadResp = await apiPostForm('/api/upload', fd);
          const uploadJson = await uploadResp.json();
          if (uploadResp.ok && uploadJson?.success && uploadJson?.url) {
            logoUrl = uploadJson.url as string;
          } else {
            console.warn('Upload du logo échoué:', uploadJson?.error);
          }
        } catch (err) {
          console.warn('Erreur lors de l\'upload du logo:', err);
        }
      }

      const response = await apiPost('/api/stores', {
        storeName: formData.storeName,
        storeDescription: formData.description,
        ownerEmail: user.primaryEmailAddress.emailAddress,
        slug,
        logoUrl,
      });

      const result = await response.json();

      if (response.ok) {
        console.log('Store created successfully:', result);
        window.location.href = `/checkout/${encodeURIComponent(slug)}`;
      } else {
        throw new Error(
          result.error || 'Erreur lors de la création de la boutique'
        );
      }
    } catch (error) {
      console.error('Erreur lors de la création de la boutique:', error);
      showToast(
        error instanceof Error ? error.message : 'Erreur lors de la création de la boutique',
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
    setFormData({ ...formData, storeName: e.target.value });
    setIsStoreNameDirty(true);
  };

  const handleStoreNameBlur = async () => {
    const name = formData.storeName.trim();
    if (!wasStoreNameFocused || !name) {
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

  // Toast notifications rendered when present

  return (
    <div className='min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8'>
      {toast && <Toast message={toast.message} type={toast.type} />}
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
            Bienvenue {user?.firstName} ! Configurons votre nouvelle boutique en
            ligne.
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
                  className={`w-full px-4 py-3 pr-10 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border ${slugExists ? 'border-red-500' : 'text-gray-700'}`}
                  placeholder='Ma Super Boutique'
                />
                {isCheckingSlug && (
                  <div className='absolute right-3 inset-y-0 flex items-center'>
                    <div className='animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-500'></div>
                  </div>
                )}
              </div>
              {slugExists && (
                <p className='mt-2 text-sm text-red-600'>Ce nom existe déjà.</p>
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

            {/* Logo */}
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-2'>
                Logo de votre boutique
              </label>
              <div className='flex items-center space-x-4'>
                <div className='flex-1'>
                  <label className='flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100'>
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
            </div>

            
            {/* Bouton de soumission */}
            <button
              type='submit'
              disabled={loading || !formData.storeName.trim() || slugExists}
              className='w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            >
              {loading ? 'Création en cours...' : 'Créer ma boutique'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
