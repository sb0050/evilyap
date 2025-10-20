import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';

const DotIcon = () => {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 512 512'
      fill='currentColor'
    >
      <path d='M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512z' />
    </svg>
  );
};

const CustomPage = () => {
  return (
    <div>
      <h1>Custom page</h1>
      <p>This is the content of the custom page.</p>
      vdgdgdssdfsddfs
    </div>
  );
};

export default function Header() {
  return (
    <header className='bg-white shadow-sm border-b'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-between items-center h-16'>
          <nav className='flex items-center space-x-6'>
            <SignedIn>
              <UserButton>
                <UserButton.UserProfilePage
                  label='Custom Page'
                  url='custom'
                  labelIcon={<DotIcon />}
                >
                  <CustomPage />
                </UserButton.UserProfilePage>
              </UserButton>
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
