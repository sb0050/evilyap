import { useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { Upload, Palette } from 'lucide-react';

interface OnboardingFormData {
  storeName: string;
  logo: File | null;
  backgroundColor: string;
  description: string;
}

const gradientOptions = [
  {
    name: 'Ocean Blue',
    value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    hex: '#667eea',
  },
  {
    name: 'Sunset Orange',
    value: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    hex: '#f093fb',
  },
  {
    name: 'Forest Green',
    value: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    hex: '#4facfe',
  },
  {
    name: 'Purple Dream',
    value: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    hex: '#a8edea',
  },
  {
    name: 'Golden Hour',
    value: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    hex: '#ffecd2',
  },
  {
    name: 'Midnight Blue',
    value: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
    hex: '#2193b0',
  },
  {
    name: 'Rose Gold',
    value: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)',
    hex: '#ee9ca7',
  },
  {
    name: 'Emerald',
    value: 'linear-gradient(135deg, #56ab2f 0%, #a8e6cf 100%)',
    hex: '#56ab2f',
  },
];

export default function OnboardingPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<OnboardingFormData>({
    storeName: '',
    logo: null,
    backgroundColor: gradientOptions[0].hex,
    description: '',
  });
  const [selectedGradient, setSelectedGradient] = useState(gradientOptions[0]);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData({ ...formData, logo: file });
      const reader = new FileReader();
      reader.onload = e => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGradientSelect = (gradient: (typeof gradientOptions)[0]) => {
    setSelectedGradient(gradient);
    setFormData({ ...formData, backgroundColor: gradient.hex });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.primaryEmailAddress?.emailAddress) {
      alert('Erreur: Email utilisateur non trouvé');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stores`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            storeName: formData.storeName,
            storeTheme: selectedGradient.value,
            storeDescription: formData.description,
            ownerEmail: user.primaryEmailAddress.emailAddress,
          }),
        }
      );

      const result = await response.json();

      if (response.ok) {
        console.log('Store created successfully:', result);
        // Rediriger vers la page de la boutique
        window.location.href = `/store/${encodeURIComponent(formData.storeName)}`;
      } else {
        throw new Error(
          result.error || 'Erreur lors de la création de la boutique'
        );
      }
    } catch (error) {
      console.error('Erreur lors de la création de la boutique:', error);
      alert(
        error instanceof Error
          ? error.message
          : 'Erreur lors de la création de la boutique'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8'>
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
              <input
                type='text'
                id='storeName'
                required
                value={formData.storeName}
                onChange={e =>
                  setFormData({ ...formData, storeName: e.target.value })
                }
                className='w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'
                placeholder='Ma Super Boutique'
              />
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
                      accept='image/*'
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

            {/* Couleur de fond / Gradient */}
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-4'>
                <Palette className='inline w-4 h-4 mr-2' />
                Choisissez un thème de couleur
              </label>
              <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
                {gradientOptions.map(gradient => (
                  <button
                    key={gradient.name}
                    type='button'
                    onClick={() => handleGradientSelect(gradient)}
                    className={`relative p-4 rounded-lg border-2 transition-all ${
                      selectedGradient.name === gradient.name
                        ? 'border-indigo-500 ring-2 ring-indigo-200'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div
                      className='w-full h-12 rounded-md mb-2'
                      style={{ background: gradient.value }}
                    />
                    <p className='text-xs text-gray-600 text-center'>
                      {gradient.name}
                    </p>
                    {selectedGradient.name === gradient.name && (
                      <div className='absolute top-2 right-2 w-4 h-4 bg-indigo-500 rounded-full flex items-center justify-center'>
                        <div className='w-2 h-2 bg-white rounded-full' />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Bouton de soumission */}
            <button
              type='submit'
              disabled={loading || !formData.storeName.trim()}
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
