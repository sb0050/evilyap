import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-6xl mx-auto px-4 py-6'>
        <h1 className='text-2xl font-semibold text-gray-900 mb-4'>Politique de confidentialité</h1>
        <div className='bg-white rounded-lg shadow border overflow-hidden' style={{ height: '80vh' }}>
          <object
            data={'/privacy_policy.pdf'}
            type='application/pdf'
            width='100%'
            height='100%'
          >
            <p className='p-4'>
              Impossible d’afficher le PDF dans votre navigateur. Vous pouvez le télécharger ici :
              <a className='text-blue-600 hover:underline ml-2' href='/privacy_policy.pdf' target='_blank' rel='noopener noreferrer'>
                privacy_policy.pdf
              </a>
            </p>
          </object>
        </div>
      </div>
    </div>
  );
}