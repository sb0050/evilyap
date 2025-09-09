import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';

export default function HomePage() {
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

        <p className='text-center text-gray-600'>
          Start your live shopping experience
        </p>
      </div>
    </div>
  );
}
