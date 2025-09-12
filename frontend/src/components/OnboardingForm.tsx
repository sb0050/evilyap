import React, { useState } from 'react';
import { ArrowLeft, Upload, X } from 'lucide-react';

interface OnboardingFormProps {
  onBack: () => void;
  isVisible: boolean;
}

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  shopName: string;
  logo: File | null;
  logoError?: string;
  hasStripe: boolean;
  stripeCheckoutUrl: string;
}

const OnboardingForm: React.FC<OnboardingFormProps> = ({
  onBack,
  isVisible,
}) => {
  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    lastName: '',
    email: '',
    shopName: '',
    logo: null,
    hasStripe: false,
    stripeCheckoutUrl: '',
  });
  const [isClosing, setIsClosing] = useState(false);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const handleInputChange = (
    field: keyof FormData,
    value: string | boolean
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({
          ...prev,
          logoError: 'Le logo ne doit pas dépasser 5MB',
        }));
        return;
      }

      // Check image dimensions
      const img = new Image();
      img.onload = () => {
        if (img.width > 2000 || img.height > 2000) {
          setErrors(prev => ({
            ...prev,
            logoError:
              'Les dimensions du logo ne doivent pas dépasser 2000x2000 pixels',
          }));
          return;
        }

        setFormData(prev => ({ ...prev, logo: file }));
        setErrors(prev => ({ ...prev, logo: undefined }));
        const reader = new FileReader();
        reader.onload = e => {
          setLogoPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      };
      img.src = URL.createObjectURL(file);
    }
  };

  const removeLogo = () => {
    setFormData(prev => ({ ...prev, logo: null }));
    setLogoPreview(null);
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.firstName.trim())
      newErrors.firstName = 'Le prénom est requis';
    if (!formData.lastName.trim()) newErrors.lastName = 'Le nom est requis';
    if (!formData.email.trim()) newErrors.email = "L'email est requis";
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Format d'email invalide";
    }
    if (!formData.shopName.trim())
      newErrors.shopName = 'Le nom de la boutique est requis';

    if (formData.hasStripe && !formData.stripeCheckoutUrl.trim()) {
      newErrors.stripeCheckoutUrl = 'Le lien Stripe est requis';
    }

    if (
      formData.hasStripe &&
      formData.stripeCheckoutUrl &&
      !formData.stripeCheckoutUrl.includes('buy.stripe.com/')
    ) {
      newErrors.stripeCheckoutUrl =
        'Le lien doit être de la forme buy.stripe.com/0000XXXX';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isFormValid = (): boolean => {
    return (
      formData.firstName.trim() !== '' &&
      formData.lastName.trim() !== '' &&
      formData.email.trim() !== '' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email) &&
      formData.shopName.trim() !== '' &&
      (!formData.hasStripe ||
        (formData.stripeCheckoutUrl.trim() !== '' &&
          formData.stripeCheckoutUrl.includes('buy.stripe.com/')))
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      console.log('Form submitted:', formData);
      // Here you would typically send the data to your backend
    }
  };

  const handleBack = () => {
    setIsClosing(true);
    setTimeout(() => {
      onBack();
      setIsClosing(false);
    }, 500);
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-black transition-transform duration-500 ease-in-out ${
        isVisible && !isClosing
          ? 'translate-x-0'
          : isClosing
            ? 'translate-x-full'
            : 'translate-x-full'
      }`}
    >
      {/* Background gradient */}
      <div className='absolute inset-0 bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900' />

      {/* Back button - Fixed positioning for mobile */}
      <button
        onClick={handleBack}
        className='fixed top-6 left-6 z-[60] bg-white/20 backdrop-blur-sm border border-white/30 text-white p-3 rounded-full transition-all duration-300 hover:bg-white/30 hover:scale-110 shadow-lg'
      >
        <ArrowLeft className='w-6 h-6' />
      </button>

      {/* Form container */}
      <div className='relative z-10 min-h-screen flex items-center justify-center p-6'>
        <div className='w-full max-w-md bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-8 shadow-2xl'>
          <form onSubmit={handleSubmit} className='space-y-6'>
            {/* Prénom */}
            <div>
              <label className='block text-white text-sm font-medium mb-2'>
                Prénom *
              </label>
              <input
                type='text'
                value={formData.firstName}
                onChange={e => handleInputChange('firstName', e.target.value)}
                className='w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all'
                placeholder='Votre prénom'
              />
              {errors.firstName && (
                <p className='text-red-400 text-sm mt-1'>{errors.firstName}</p>
              )}
            </div>

            {/* Nom */}
            <div>
              <label className='block text-white text-sm font-medium mb-2'>
                Nom *
              </label>
              <input
                type='text'
                value={formData.lastName}
                onChange={e => handleInputChange('lastName', e.target.value)}
                className='w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all'
                placeholder='Votre nom'
              />
              {errors.lastName && (
                <p className='text-red-400 text-sm mt-1'>{errors.lastName}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className='block text-white text-sm font-medium mb-2'>
                Email *
              </label>
              <input
                type='email'
                value={formData.email}
                onChange={e => handleInputChange('email', e.target.value)}
                className='w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all'
                placeholder='votre@email.com'
              />
              {errors.email && (
                <p className='text-red-400 text-sm mt-1'>{errors.email}</p>
              )}
            </div>

            {/* Nom de la boutique */}
            <div>
              <label className='block text-white text-sm font-medium mb-2'>
                Nom de la boutique *
              </label>
              <input
                type='text'
                value={formData.shopName}
                onChange={e => handleInputChange('shopName', e.target.value)}
                className='w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all'
                placeholder='Le nom de votre boutique'
              />
              {errors.shopName && (
                <p className='text-red-400 text-sm mt-1'>{errors.shopName}</p>
              )}
            </div>

            {/* Logo */}
            <div>
              <label className='block text-white text-sm font-medium mb-2'>
                Logo de la boutique
              </label>
              <div className='relative'>
                {logoPreview ? (
                  <div className='relative bg-white/10 border border-white/30 rounded-lg p-4 flex items-center justify-center'>
                    <img
                      src={logoPreview}
                      alt='Logo preview'
                      className='max-h-20 max-w-full object-contain'
                    />
                    <button
                      type='button'
                      onClick={removeLogo}
                      className='absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors'
                    >
                      <X className='w-4 h-4' />
                    </button>
                  </div>
                ) : (
                  <label className='cursor-pointer'>
                    <div className='bg-white/10 border border-white/30 border-dashed rounded-lg p-8 text-center hover:bg-white/20 transition-colors'>
                      <Upload className='w-8 h-8 text-white/60 mx-auto mb-2' />
                      <p className='text-white/60 text-sm'>
                        Cliquez pour ajouter votre logo
                      </p>
                    </div>
                    <input
                      type='file'
                      accept='image/*'
                      onChange={handleLogoUpload}
                      className='hidden'
                    />
                  </label>
                )}
              </div>
              {errors.logoError && (
                <p className='text-red-400 text-sm mt-1'>{errors.logoError}</p>
              )}
            </div>

            {/* Compte Stripe */}
            <div>
              <label className='flex items-center space-x-3 cursor-pointer'>
                <input
                  type='checkbox'
                  checked={formData.hasStripe}
                  onChange={e =>
                    handleInputChange('hasStripe', e.target.checked)
                  }
                  className='w-5 h-5 text-purple-500 bg-white/10 border-white/30 rounded focus:ring-purple-500 focus:ring-2'
                />
                <span className='text-white text-sm font-medium'>
                  J'ai déjà un compte Stripe
                </span>
              </label>
            </div>

            {/* Lien Stripe */}
            {formData.hasStripe && (
              <div className='animate-fadeIn'>
                <label className='block text-white text-sm font-medium mb-2'>
                  Lien Stripe Checkout *
                </label>
                <input
                  type='url'
                  value={formData.stripeCheckoutUrl}
                  onChange={e =>
                    handleInputChange('stripeCheckoutUrl', e.target.value)
                  }
                  className='w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all'
                  placeholder='buy.stripe.com/0000XXXX'
                />
                {errors.stripeCheckoutUrl && (
                  <p className='text-red-400 text-sm mt-1'>
                    {errors.stripeCheckoutUrl}
                  </p>
                )}
              </div>
            )}

            {/* Submit button */}
            <button
              type='submit'
              disabled={!isFormValid()}
              className={`w-full font-bold py-4 px-6 rounded-lg transition-all duration-300 transform shadow-lg ${
                isFormValid()
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 hover:scale-105 cursor-pointer'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              Commencer avec PayLive
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OnboardingForm;
