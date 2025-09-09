import { UserProfile } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { Package, CreditCard, Shield, User } from 'lucide-react';

export default function AccountPage() {
  return (
    <div className='max-w-6xl mx-auto px-4 py-8'>
      <div className='grid grid-cols-1 lg:grid-cols-4 gap-8'>
        <div className='lg:col-span-1'>
          <div className='bg-white rounded-lg shadow-md p-6'>
            <h2 className='text-xl font-bold text-gray-900 mb-2'>Account</h2>
            <p className='text-gray-600 mb-6'>Manage your account info.</p>

            <nav className='space-y-2'>
              <div className='flex items-center space-x-3 p-3 bg-gray-100 rounded-md'>
                <User className='h-5 w-5 text-gray-600' />
                <span className='text-gray-900 font-medium'>Profile</span>
              </div>
              <div className='flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-md cursor-pointer'>
                <Shield className='h-5 w-5 text-gray-600' />
                <span className='text-gray-700'>Security</span>
              </div>
              <div className='flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-md cursor-pointer'>
                <CreditCard className='h-5 w-5 text-gray-600' />
                <span className='text-gray-700'>Billing</span>
              </div>
              <Link
                to='/orders'
                className='flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-md'
              >
                <Package className='h-5 w-5 text-gray-600' />
                <span className='text-gray-700'>Orders</span>
              </Link>
            </nav>

            <div className='mt-8 pt-6 border-t'>
              <p className='text-sm text-gray-500'>Secured by Clerk</p>
            </div>
          </div>
        </div>

        <div className='lg:col-span-3'>
          <div className='bg-white rounded-lg shadow-md'>
            <UserProfile />
          </div>
        </div>
      </div>
    </div>
  );
}
