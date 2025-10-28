import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShoppingCart, Star, Package, Truck, Shield, ArrowLeft, ShoppingBag, Users, TrendingUp, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';

interface Store {
  id: number;
  name: string;
  description: string;
  owner_email: string;
  slug: string;
}

const StorePage: React.FC = () => {
  const { storeName } = useParams<{ storeName: string }>();
  const { user } = useUser();
  const navigate = useNavigate();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStore = async () => {
      if (!storeName) {
        setError('Nom de boutique manquant');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stores/${encodeURIComponent(storeName)}`
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Erreur lors du chargement de la boutique'
          );
        }

        setStore(data.store);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    };

    fetchStore();
  }, [storeName]);

  if (loading) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600'></div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <h1 className='text-2xl font-bold text-gray-900 mb-4'>
            Boutique non trouvée
          </h1>
          <p className='text-gray-600'>
            {error || "Cette boutique n'existe pas."}
          </p>
        </div>
      </div>
    );
  }

  const isOwner = user?.primaryEmailAddress?.emailAddress === store.owner_email;

  const cloudBase = (import.meta.env.VITE_CLOUDFRONT_URL || 'https://d1tmgyvizond6e.cloudfront.net').replace(/\/+$/, '');
  const storeLogo = store?.id ? `${cloudBase}/images/${store.id}` : undefined;

  return (
    <div className='min-h-screen bg-gradient-to-b from-indigo-50 to-white'>
      {/* Header avec overlay pour la lisibilité */}
      <div className='bg-black bg-opacity-20 backdrop-blur-sm'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
          <div className='flex items-center space-x-6'>
            {/* Logo de la boutique */}
            {storeLogo ? (
              <img
                src={storeLogo}
                alt={`Logo ${store.name}`}
                className='w-20 h-20 rounded-full object-cover border-4 border-white shadow-lg'
              />
            ) : (
              <div className='w-20 h-20 rounded-full bg-white bg-opacity-20 flex items-center justify-center border-4 border-white shadow-lg'>
                <ShoppingBag className='w-10 h-10 text-white' />
              </div>
            )}

            <div>
              <h1 className='text-4xl font-bold text-white mb-2'>
                {store.name}
              </h1>
              {store.description && (
                <p className='text-xl text-white text-opacity-90'>
                  {store.description}
                </p>
              )}
              {isOwner && (
                <span className='inline-block mt-2 px-3 py-1 bg-white bg-opacity-20 text-white text-sm rounded-full'>
                  Votre boutique
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12'>
        <div className='bg-white rounded-lg shadow-xl p-8'>
          {isOwner ? (
            // Vue propriétaire - Tableau de bord
            <>
              <div className='mb-8'>
                <h2 className='text-2xl font-bold text-gray-900 mb-4'>
                  Tableau de bord
                </h2>
                <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
                  <div className='bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-6 text-white'>
                    <div className='flex items-center'>
                      <ShoppingBag className='w-8 h-8 mr-3' />
                      <div>
                        <p className='text-blue-100'>Produits</p>
                        <p className='text-2xl font-bold'>0</p>
                      </div>
                    </div>
                  </div>

                  <div className='bg-gradient-to-r from-green-500 to-green-600 rounded-lg p-6 text-white'>
                    <div className='flex items-center'>
                      <TrendingUp className='w-8 h-8 mr-3' />
                      <div>
                        <p className='text-green-100'>Ventes</p>
                        <p className='text-2xl font-bold'>0€</p>
                      </div>
                    </div>
                  </div>

                  <div className='bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg p-6 text-white'>
                    <div className='flex items-center'>
                      <Users className='w-8 h-8 mr-3' />
                      <div>
                        <p className='text-purple-100'>Clients</p>
                        <p className='text-2xl font-bold'>0</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Paramètres rapides */}
              <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
                <div className='bg-gray-50 rounded-lg p-6'>
                  <h3 className='text-lg font-semibold text-gray-900 mb-4'>
                    Paramètres de la boutique
                  </h3>
                  <div className='space-y-4'>
                    <button className='w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition'>
                      Modifier le logo
                    </button>
                    <button className='w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition'>
                      Gérer les catégories
                    </button>
                    <button className='w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition'>
                      Ajouter un produit
                    </button>
                  </div>
                </div>

                <div className='bg-gray-50 rounded-lg p-6'>
                  <h3 className='text-lg font-semibold text-gray-900 mb-4'>
                    Statistiques
                  </h3>
                  <div className='grid grid-cols-2 gap-4'>
                    <div className='p-4 bg-white rounded-lg shadow-sm'>
                      <p className='text-sm text-gray-500'>Taux de conversion</p>
                      <p className='text-2xl font-bold text-gray-900'>0%</p>
                    </div>
                    <div className='p-4 bg-white rounded-lg shadow-sm'>
                      <p className='text-sm text-gray-500'>Panier moyen</p>
                      <p className='text-2xl font-bold text-gray-900'>0€</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            // Vue client - Catalogue de produits
            <div className='text-center py-12'>
              <ShoppingBag className='w-16 h-16 text-gray-400 mx-auto mb-4' />
              <h2 className='text-2xl font-bold text-gray-900 mb-4'>
                Boutique de {store.name}
              </h2>
              <p className='text-gray-600 mb-8'>
                Cette boutique n'a pas encore de produits disponibles.
              </p>
              <p className='text-sm text-gray-500'>
                Revenez bientôt pour découvrir les nouveautés !
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StorePage;