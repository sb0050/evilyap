import { Link } from 'react-router-dom';
import { ShoppingBag, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';

export default function HomePage() {
  const [testResult, setTestResult] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error';
    message: string;
    details?: any;
  }>({ status: 'idle', message: '' });

  const testBackendConnection = async () => {
    setTestResult({ status: 'loading', message: 'Test en cours...' });
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      console.log('🧪 Testing backend connection to:', apiUrl);
      
      const response = await fetch(`${apiUrl}/api/ping`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setTestResult({
        status: 'success',
        message: 'Backend accessible !',
        details: data
      });
    } catch (error: any) {
      console.error('❌ Backend test failed:', error);
      setTestResult({
        status: 'error',
        message: `Erreur: ${error.message}`,
        details: error
      });
    }
  };
  return (
    <div className='max-w-4xl mx-auto px-4 py-12'>
      <div className='text-center mb-12'>
        <ShoppingBag className='h-16 w-16 text-amber-600 mx-auto mb-4' />
        <h1 className='text-4xl font-bold text-gray-900 mb-2'>LM OUTLET</h1>
        <p className='text-xl text-gray-600 mb-8'>LIVE SHOP</p>
        <h2 className='text-2xl font-semibold text-gray-800 mb-8'>
          LIVE SHOPPING
        </h2>
      </div>

      <div className='bg-white rounded-lg shadow-md p-8'>
        <div className='flex items-center justify-center space-x-4 mb-8'>
          <input
            type='number'
            placeholder='500'
            className='border border-gray-300 rounded-md px-4 py-2 w-32 text-center'
          />
          <span className='text-gray-600'>€</span>
          <Link
            to='/checkout'
            className='bg-slate-700 text-white px-8 py-2 rounded-md hover:bg-slate-800 transition-colors'
          >
            Valider
          </Link>
        </div>

        <p className='text-center text-gray-600 mb-8'>
          Start your live shopping experience
        </p>
        
        {/* Section de test API */}
        <div className='border-t pt-8'>
          <div className='text-center'>
            <h3 className='text-lg font-semibold text-gray-800 mb-4'>
              Test de connectivité Backend
            </h3>
            
            <button
              onClick={testBackendConnection}
              disabled={testResult.status === 'loading'}
              className='bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 mx-auto'
            >
              {testResult.status === 'loading' ? (
                <div className='animate-spin rounded-full h-4 w-4 border-b-2 border-white'></div>
              ) : testResult.status === 'success' ? (
                <Wifi className='h-4 w-4' />
              ) : testResult.status === 'error' ? (
                <WifiOff className='h-4 w-4' />
              ) : (
                <Wifi className='h-4 w-4' />
              )}
              <span>
                {testResult.status === 'loading' ? 'Test en cours...' : 'Tester l\'API Backend'}
              </span>
            </button>
            
            {testResult.status !== 'idle' && (
              <div className={`mt-4 p-4 rounded-md ${
                testResult.status === 'success' 
                  ? 'bg-green-50 border border-green-200' 
                  : testResult.status === 'error'
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-blue-50 border border-blue-200'
              }`}>
                <p className={`font-medium ${
                  testResult.status === 'success' 
                    ? 'text-green-800' 
                    : testResult.status === 'error'
                    ? 'text-red-800'
                    : 'text-blue-800'
                }`}>
                  {testResult.message}
                </p>
                
                {testResult.details && (
                  <details className='mt-2'>
                    <summary className={`cursor-pointer text-sm ${
                      testResult.status === 'success' 
                        ? 'text-green-600' 
                        : testResult.status === 'error'
                        ? 'text-red-600'
                        : 'text-blue-600'
                    }`}>
                      Détails de la réponse
                    </summary>
                    <pre className={`mt-2 text-xs p-2 rounded overflow-auto ${
                      testResult.status === 'success' 
                        ? 'bg-green-100 text-green-800' 
                        : testResult.status === 'error'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}>
                      {JSON.stringify(testResult.details, null, 2)}
                    </pre>
                  </details>
                )}
                
                <p className='text-xs text-gray-600 mt-2'>
                  URL testée: {import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/ping
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
