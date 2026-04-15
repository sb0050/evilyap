import React from 'react';
import { UserButton } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';

export default function AdminPage() {
  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='fixed top-4 right-4 z-50'>
        <UserButton />
      </div>

      <div className='max-w-3xl mx-auto px-4 py-16'>
        <div className='bg-white rounded-xl shadow p-8 text-center'>
          <h1 className='text-3xl font-bold text-gray-900 mb-3'>
            Bienvenue sur les outils internes de PayLive
          </h1>
          <p className='text-gray-600 mb-8'>
            Choisissez une section pour commencer.
          </p>

          <div className='flex flex-col sm:flex-row gap-4 justify-center'>
            <Link
              to='/admin/mails'
              className='inline-flex items-center justify-center px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold'
            >
              Campagne d'email
            </Link>
            <Link
              to='/admin/leads'
              className='inline-flex items-center justify-center px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold'
            >
              Tableau de prospects
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
