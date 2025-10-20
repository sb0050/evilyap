import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';

export default function Header() {
  return (
    <header className='bg-white shadow-sm border-b'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-between items-center h-16'>
          <Link to='/' className='flex items-center space-x-2'>
            <ShoppingBag className='h-8 w-8 text-amber-600' />
            <div className='text-center'>
              <h1 className='text-xl font-bold text-gray-900'>LM OUTLET</h1>
              <p className='text-xs text-gray-600'>LIVE SHOP</p>
            </div>
          </Link>

          <nav className='flex items-center space-x-6'>
            <SignedIn>
              <UserButton />
            </SignedIn>
            <SignedOut>
              <SignInButton mode='modal'>
                <button className='bg-slate-700 text-white px-4 py-2 rounded-md hover:bg-slate-800'>
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
          </nav>
        </div>
      </div>
    </header>
  );
}
