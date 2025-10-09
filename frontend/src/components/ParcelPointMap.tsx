import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useState, useRef } from 'react';
import { createShippingOrder } from '../utils/api';
import { CreateShippingOrderRequest } from '../types/shipping';

// Types pour les points relais selon la réponse Boxtal
interface OpeningHours {
  openingTime: string;
  closingTime: string;
}

interface OpeningDays {
  MONDAY?: OpeningHours[];
  TUESDAY?: OpeningHours[];
  WEDNESDAY?: OpeningHours[];
  THURSDAY?: OpeningHours[];
  FRIDAY?: OpeningHours[];
  SATURDAY?: OpeningHours[];
  SUNDAY?: OpeningHours[];
}

interface ParcelPointLocation {
  city: string;
  state?: string;
  number?: string;
  street: string;
  position: {
    latitude: number;
    longitude: number;
  };
  postalCode: string;
  countryIsoCode: string;
}

export interface ParcelPointData {
  code: string;
  name: string;
  status: string;
  network: string;
  location: ParcelPointLocation;
  openingDays: OpeningDays;
}

interface ParcelPointResponse {
  parcelPoint: ParcelPointData;
  distanceFromSearchLocation: number;
}

interface BoxtalApiResponse {
  status: number;
  timestamp: string;
  content: ParcelPointResponse[];
}

// Correction des icônes par défaut de Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Icône rouge pour l'adresse de livraison
const redIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Icônes colorées pour chaque réseau de points relais
const networkIcons = {
  SOGP: new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }),
  MONR: new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }),
  CHRP: new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }),
  COPR: new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }),
  UPSE: new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }),
  DHLE: new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }),
};

// Configuration des réseaux avec tarifs et délais
const networkConfig = {
  SOGP: {
    name: 'Relais Colis',
    color: '#3B82F6',
    delay: '3 à 5 jours',
    prices: {
      '250g': 3.63,
      '500g': 3.63,
      '1kg': 3.71,
      '2kg': 5.24,
      '3kg': 5.45,
      '5kg': 7.67,
      '7kg': 9.56,
      '10kg': 10.96,
      '15kg': 13.92,
      '20kg': 16.32,
      '30kg': 16.32,
    },
  },
  MONR: {
    name: 'Mondial Relay',
    color: '#10B981',
    delay: '3 à 4 jours',
    prices: {
      '250g': 3.18,
      '500g': 3.26,
      '1kg': 3.88,
      '2kg': 5.0,
      '3kg': 5.61,
      '5kg': 9.1,
      '7kg': 10.49,
      '10kg': 10.92,
      '15kg': 16.99,
      '20kg': 16.99,
      '30kg': 24.57,
    },
  },
  CHRP: {
    name: 'Chronopost',
    color: '#F59E0B',
    delay: '2 à 4 jours',
    prices: {
      '250g': 2.99,
      '500g': 3.1,
      '1kg': 3.66,
      '2kg': 4.63,
      '3kg': 5.1,
      '5kg': 7.21,
      '7kg': 8.49,
      '10kg': 10.42,
      '15kg': 13.64,
      '20kg': 16.86,
      '30kg': 16.86,
    },
  },
  COPR: {
    name: 'Colis Privé',
    color: '#8B5CF6',
    delay: '6 jours',
    prices: {
      '250g': 3.54,
      '500g': 3.54,
      '1kg': 4.09,
      '2kg': 5.35,
      '3kg': 5.58,
      '5kg': 8.36,
      '7kg': 10.33,
      '10kg': 10.33,
      '15kg': 12.55,
      '20kg': 16.52,
      '30kg': 16.52,
    },
  },
};

// Configuration des options de livraison à domicile
const homeDeliveryConfig = {
  COPR_HOME: {
    name: 'Colis Privé - Domicile Sans Signature',
    color: '#8B5CF6',
    delay: '6 jours',
    prices: {
      '250g': 5.3,
      '500g': 6.08,
      '1kg': 7.9,
      '2kg': 8.84,
      '3kg': 9.83,
      '5kg': 11.83,
      '7kg': 13.72,
      '10kg': 16.61,
      '15kg': 22.83,
      '20kg': 29.67,
      '30kg': 29.67,
    },
  },
  COLI_HOME: {
    name: 'Colissimo - Domicile Sans Signature',
    color: '#FF6B35',
    delay: '48h',
    prices: {
      '250g': 7.24,
      '500g': 8.15,
      '1kg': 9.87,
      '2kg': 11.07,
      '3kg': 12.15,
      '5kg': 14.3,
      '7kg': 16.01,
      '10kg': 19.19,
      '15kg': 24.0,
      '20kg': 29.15,
      '30kg': 39.09,
    },
  },
  MONR_HOME: {
    name: 'Mondial Relay - Domicile France',
    color: '#10B981',
    delay: '5 jours',
    prices: {
      '250g': 6.27,
      '500g': 6.83,
      '1kg': 7.66,
      '2kg': 8.91,
      '3kg': 10.5,
      '5kg': 12.61,
      '7kg': 13.67,
      '10kg': 16.81,
      '15kg': 21.02,
      '20kg': 34.7,
      '30kg': 34.7,
    },
  },
};

interface ParcelPointMapProps {
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    postal_code?: string;
    country?: string;
  };
  onParcelPointSelect?: (
    parcelPoint: ParcelPointData | null,
    deliveryMethod: 'home_delivery' | 'pickup_point',
    deliveryCost?: number,
    selectedWeight?: string,
    homeDeliveryNetwork?: string
  ) => void;
  defaultDeliveryMethod?: 'home_delivery' | 'pickup_point';
  defaultParcelPoint?: ParcelPointData | null;
  defaultParcelPointCode?: string;
  disablePopupsOnMobile?: boolean;
  initialHomeDeliveryNetwork?: string;
}

// Composant pour gérer l'animation panTo
function MapController({
  targetCoordinates,
}: {
  targetCoordinates: [number, number] | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (targetCoordinates && map) {
      // Animation fluide vers les nouvelles coordonnées
      map.panTo(targetCoordinates, {
        animate: true,
        duration: 1.5, // 1.5 secondes d'animation
        easeLinearity: 0.1, // Courbe d'animation plus fluide
      });
    }
  }, [targetCoordinates, map]);

  return null;
}

export default function ParcelPointMap({
  address,
  onParcelPointSelect,
  defaultDeliveryMethod = 'home_delivery',
  disablePopupsOnMobile = false,
  initialHomeDeliveryNetwork,
}: ParcelPointMapProps) {
  const [parcelPoints, setParcelPoints] = useState<ParcelPointResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<ParcelPointData | null>(
    null
  );
  const [networkFilter, setNetworkFilter] = useState<string>('ALL');
  const [selectedWeight, setSelectedWeight] = useState<string>('250g');
  const [deliveryType, setDeliveryType] = useState<string>(
    defaultDeliveryMethod === 'pickup_point' ? 'PICKUP' : 'HOME'
  );
  const [selectedHomeDelivery, setSelectedHomeDelivery] = useState<string>('');
  const [isCreatingOrder, setIsCreatingOrder] = useState<boolean>(false);
  const [orderSuccess, setOrderSuccess] = useState<boolean>(false);
  const [isMobileTailwind, setIsMobileTailwind] = useState<boolean>(false);
  const [needsRefresh, setNeedsRefresh] = useState<boolean>(false);
  const refreshBtnRef = useRef<HTMLButtonElement | null>(null);
  const [canShowRefreshMessages, setCanShowRefreshMessages] =
    useState<boolean>(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const checkMobile = () => {
        setIsMobileTailwind(window.innerWidth < 768);
      };
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  // Coordonnées par défaut (Paris - Place Vendôme)
  const defaultCoordinates: [number, number] = [48.8566, 2.3522];
  const [addressCoordinates, setAddressCoordinates] = useState<
    [number, number] | null
  >(null);

  // Géocoder l'adresse pour obtenir ses coordonnées
  const geocodeAddress = async (
    searchAddress: any
  ): Promise<[number, number] | null> => {
    try {
      const addressString = `${searchAddress.line1}, ${searchAddress.postal_code} ${searchAddress.city}, ${searchAddress.country || 'FR'}`;
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressString)}&limit=1`
      );

      if (!response.ok) {
        throw new Error('Erreur de géocodage');
      }

      const data = await response.json();
      if (data && data.length > 0) {
        return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      }
      return null;
    } catch (err) {
      console.error('Erreur de géocodage:', err);
      return null;
    }
  };

  // Récupérer les points relais depuis l'API
  const fetchParcelPoints = async (searchAddress: any) => {
    if (
      !searchAddress?.line1 ||
      !searchAddress?.city ||
      !searchAddress?.postal_code
    ) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // D'abord, géocoder l'adresse pour centrer la carte
      const coords = await geocodeAddress(searchAddress);
      if (coords) {
        setAddressCoordinates(coords);
      }

      const requestBody = {
        street: searchAddress.line1,
        city: searchAddress.city,
        postalCode: searchAddress.postal_code,
        countryIsoCode: searchAddress.country || 'FR',
        searchNetworks: 'SOGP,MONR,CHRP,COPR,UPSE,DHLE',
      };

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/boxtal/parcel-points`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        throw new Error(`Erreur HTTP: ${response.status}`);
      }

      const data: BoxtalApiResponse = await response.json();
      setParcelPoints(data.content || []);
    } catch (err) {
      console.error('Erreur lors de la récupération des points relais:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  // Effet pour charger les points relais quand l'adresse change
  const lastLine1Ref = useRef<string | undefined>(undefined);
  const autoSelectRef = useRef<boolean>(false);

  useEffect(() => {
    const markSelection = (e: Event) => {
      const container = document.getElementById('autocomplete-search');
      if (
        container &&
        e.target instanceof Node &&
        container.contains(e.target)
      ) {
        autoSelectRef.current = true;
      }
    };
    document.addEventListener('mousedown', markSelection, true);
    document.addEventListener('click', markSelection, true);
    return () => {
      document.removeEventListener('mousedown', markSelection, true);
      document.removeEventListener('click', markSelection, true);
    };
  }, []);

  useEffect(() => {
    const currentLine1 = address?.line1;
    if (currentLine1 && currentLine1 !== lastLine1Ref.current) {
      lastLine1Ref.current = currentLine1;
      // Ne pas fetch automatiquement, demander un refresh manuel
      setNeedsRefresh(true);
    } else if (!currentLine1) {
      // Réinitialiser quand l'adresse est effacée
      setParcelPoints([]);
      setAddressCoordinates(null);
      setError(null);
      setNeedsRefresh(false);
    }
  }, [address?.line1]);

  const handleManualRefresh = () => {
    if (address && address.line1) {
      fetchParcelPoints(address);
      setNeedsRefresh(false);
    }
  };

  // Formatage des horaires d'ouverture
  const formatOpeningHours = (openingDays: OpeningDays): string => {
    const days = [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ];
    const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

    return days
      .map((day, index) => {
        const hours = openingDays[day as keyof OpeningDays];
        if (hours && hours.length > 0) {
          return `${dayNames[index]}: ${hours[0].openingTime}-${hours[0].closingTime}`;
        }
        return `${dayNames[index]}: Fermé`;
      })
      .join(', ');
  };

  // Effet pour initialiser les valeurs par défaut
  useEffect(() => {
    if (defaultDeliveryMethod) {
      setDeliveryType(
        defaultDeliveryMethod === 'pickup_point' ? 'PICKUP' : 'HOME'
      );
    }
  }, [defaultDeliveryMethod]);

  // Gestion de la sélection d'un point relais
  const handleMarkerClick = (parcelPoint: ParcelPointData) => {
    setSelectedPoint(parcelPoint);
    const cost = getDeliveryPrice(parcelPoint.network, false);
    if (onParcelPointSelect) {
      onParcelPointSelect(
        parcelPoint,
        'pickup_point',
        cost,
        selectedWeight,
        undefined
      );
    }
  };

  // Gestion du changement de type de livraison
  const handleDeliveryTypeChange = (type: string) => {
    setDeliveryType(type);
    if (type === 'HOME') {
      setSelectedPoint(null);
      // Ne pas notifier avec coût tant qu'une option n'est pas choisie
      if (onParcelPointSelect) {
        onParcelPointSelect(
          null,
          'home_delivery',
          undefined,
          selectedWeight,
          selectedHomeDelivery || undefined
        );
      }
    } else if (type === 'PICKUP' && selectedPoint && onParcelPointSelect) {
      const cost = getDeliveryPrice(selectedPoint.network, false);
      onParcelPointSelect(
        selectedPoint,
        'pickup_point',
        cost,
        selectedWeight,
        undefined
      );
    }
  };

  // Gestion de la sélection d'une option de livraison à domicile
  const handleHomeDeliverySelect = (deliveryKey: string) => {
    setSelectedHomeDelivery(deliveryKey);
    // Calculer coût via homeDeliveryConfig
    const config =
      homeDeliveryConfig[deliveryKey as keyof typeof homeDeliveryConfig];
    const price =
      config?.prices[selectedWeight as keyof typeof config.prices] || 0;
    if (onParcelPointSelect) {
      onParcelPointSelect(
        null,
        'home_delivery',
        price,
        selectedWeight,
        deliveryKey
      );
    }
  };

  // Filtrer les points relais selon le réseau sélectionné (sans UPS et DHL)
  const filteredParcelPoints = parcelPoints.filter(pointResponse => {
    const network = pointResponse.parcelPoint.network;
    // Exclure UPS et DHL
    if (network === 'UPSE' || network === 'DHLE') return false;
    if (networkFilter === 'ALL') return true;
    return network === networkFilter;
  });

  // Calculer le prix de livraison pour un point relais ou domicile
  const getDeliveryPrice = (
    network: string,
    isHomeDelivery: boolean = false
  ): number => {
    if (isHomeDelivery) {
      const homeKey = `${network}_HOME` as keyof typeof homeDeliveryConfig;
      const config = homeDeliveryConfig[homeKey];
      if (!config || !config.prices) return 0;
      return config.prices[selectedWeight as keyof typeof config.prices] || 0;
    } else {
      const config = networkConfig[network as keyof typeof networkConfig];
      if (!config || !config.prices) return 0;
      return config.prices[selectedWeight as keyof typeof config.prices] || 0;
    }
  };

  // Obtenir le délai de livraison
  const getDeliveryDelay = (
    network: string,
    isHomeDelivery: boolean = false
  ): string => {
    if (isHomeDelivery) {
      const homeKey = `${network}_HOME` as keyof typeof homeDeliveryConfig;
      const config = homeDeliveryConfig[homeKey];
      return config?.delay || '';
    } else {
      const config = networkConfig[network as keyof typeof networkConfig];
      return config?.delay || '';
    }
  };

  if (!address?.line1) {
    return (
      <div className='bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center'>
        <div className='text-gray-500'>
          <svg
            className='mx-auto h-12 w-12 text-gray-400'
            fill='none'
            viewBox='0 0 24 24'
            stroke='currentColor'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z'
            />
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M15 11a3 3 0 11-6 0 3 3 0 016 0z'
            />
          </svg>
          <h3 className='mt-2 text-sm font-medium text-gray-900'>
            En attente d'une adresse complète
          </h3>
          <p className='mt-1 text-sm text-gray-500'>
            Sélectionnez une adresse depuis les suggestions de l'autocomplétion
            pour voir les points relais à proximité
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='relative'>
      <div className='bg-white rounded-lg border border-gray-200'>
        {/* Header */}
        <div className='bg-slate-50 px-4 py-3 border-b border-gray-200'>
          <div className='flex items-center justify-between mb-3'>
            <h4 className='text-sm font-medium text-gray-900'>
              Points relais à proximité
              {needsRefresh && canShowRefreshMessages && (
                <span className='ml-2 inline-flex items-center rounded-full bg-yellow-100 text-yellow-800 px-2 py-0.5 text-[10px] border border-yellow-200'>
                  à mettre à jour
                </span>
              )}
            </h4>
            <div className='flex items-center space-x-2'>
              <div className='flex items-center space-x-2 text-xs text-gray-500'>
                {loading && (
                  <span className='text-blue-600'>🔄 Chargement...</span>
                )}
                {error && <span className='text-red-600'>❌ Erreur</span>}
              </div>
              {address?.line1 && needsRefresh && canShowRefreshMessages && (
                <button
                  ref={refreshBtnRef}
                  onClick={handleManualRefresh}
                  disabled={loading}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    loading
                      ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                      : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                  }`}
                  title='Rafraîchir les points relais'
                >
                  {'🔄 Rafraîchir (adresse modifiée)'}
                </button>
              )}
            </div>
          </div>
          {needsRefresh && canShowRefreshMessages && (
            <div className='mb-3 px-3 py-2 rounded bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs'>
              L'adresse a été modifiée. Cliquez sur "Rafraîchir" pour charger
              les points relais à proximité.
            </div>
          )}

          {/* Filtres */}
          <div className='space-y-3 mb-3'>
            {/* Première ligne : Type de livraison */}
            <div className='flex items-center space-x-4'>
              <label className='text-xs font-medium text-gray-700'>
                Type de livraison:
              </label>
              <div className='flex space-x-4'>
                <label className='flex items-center space-x-1'>
                  <input
                    type='radio'
                    name='deliveryType'
                    value='PICKUP'
                    checked={deliveryType === 'PICKUP'}
                    onChange={e => handleDeliveryTypeChange(e.target.value)}
                    className='text-blue-600'
                  />
                  <span className='text-xs text-gray-700'>Point relais</span>
                </label>
                <label className='flex items-center space-x-1'>
                  <input
                    type='radio'
                    name='deliveryType'
                    value='HOME'
                    checked={deliveryType === 'HOME'}
                    onChange={e => handleDeliveryTypeChange(e.target.value)}
                    className='text-blue-600'
                  />
                  <span className='text-xs text-gray-700'>
                    Livraison à domicile
                  </span>
                </label>
              </div>
            </div>

            {/* Deuxième ligne : Filtres et poids */}
            <div className='flex items-center flex-wrap gap-4'>
              {deliveryType === 'PICKUP' && (
                <div className='flex items-center space-x-2'>
                  <label className='text-xs font-medium text-gray-700'>
                    Filtrer par réseau:
                  </label>
                  <select
                    value={networkFilter}
                    onChange={e => setNetworkFilter(e.target.value)}
                    className='text-xs border border-gray-300 rounded px-2 py-1 bg-white'
                  >
                    <option value='ALL'>Tous les réseaux</option>
                    <option value='SOGP'>Relais Colis</option>
                    <option value='MONR'>Mondial Relay</option>
                    <option value='CHRP'>Chronopost</option>
                    <option value='COPR'>Colis Privé</option>
                  </select>
                </div>
              )}
              <div className='flex items-center space-x-2'>
                <label className='text-xs font-medium text-gray-700'>
                  Poids du colis:
                </label>
                <select
                  value={selectedWeight}
                  onChange={e => setSelectedWeight(e.target.value)}
                  className='text-xs border border-gray-300 rounded px-2 py-1 bg-white'
                >
                  <option value='250g'>250g</option>
                  <option value='500g'>500g</option>
                  <option value='1kg'>1kg</option>
                  <option value='2kg'>2kg</option>
                  <option value='3kg'>3kg</option>
                  <option value='5kg'>5kg</option>
                  <option value='7kg'>7kg</option>
                  <option value='10kg'>10kg</option>
                  <option value='15kg'>15kg</option>
                  <option value='20kg'>20kg</option>
                  <option value='30kg'>30kg</option>
                </select>
              </div>
            </div>
          </div>

          {/* Légende */}
          <div className='flex flex-wrap items-center gap-3 text-xs mb-3'>
            <div className='flex items-center space-x-1'>
              <div className='w-3 h-3 bg-red-500 rounded-full'></div>
              <span className='text-gray-600'>Votre adresse</span>
            </div>
            <div className='flex items-center space-x-1'>
              <div className='w-3 h-3 bg-blue-500 rounded-full'></div>
              <span className='text-gray-600'>Relais Colis</span>
            </div>
            <div className='flex items-center space-x-1'>
              <div className='w-3 h-3 bg-green-500 rounded-full'></div>
              <span className='text-gray-600'>Mondial Relay</span>
            </div>
            <div className='flex items-center space-x-1'>
              <div className='w-3 h-3 bg-orange-500 rounded-full'></div>
              <span className='text-gray-600'>Chronopost</span>
            </div>
            <div className='flex items-center space-x-1'>
              <div className='w-3 h-3 bg-purple-500 rounded-full'></div>
              <span className='text-gray-600'>Colis Privé</span>
            </div>
          </div>

          {address && (
            <p className='text-xs text-gray-600'>
              {address.line1}, {address.postal_code} {address.city}
            </p>
          )}
        </div>

        {/* Contenu principal */}
        <div className='relative'>
          {deliveryType === 'PICKUP' && (
            <>
              {loading && (
                <div className='absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10'>
                  <div className='text-center'>
                    <div className='inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-slate-700'></div>
                    <p className='mt-2 text-sm text-gray-600'>
                      Recherche des points relais...
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className='p-4 bg-red-50 border-l-4 border-red-400'>
                  <div className='flex'>
                    <div className='ml-3'>
                      <p className='text-sm text-red-700'>
                        <strong>Erreur:</strong> {error}
                      </p>
                      <button
                        onClick={handleManualRefresh}
                        className='mt-2 text-sm text-red-600 hover:text-red-800 underline'
                      >
                        Réessayer
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ height: '400px', width: '100%' }}>
                <MapContainer
                  center={defaultCoordinates}
                  zoom={14}
                  scrollWheelZoom={true}
                  style={{ height: '100%', width: '100%' }}
                >
                  {/* Contrôleur pour l'animation panTo */}
                  <MapController targetCoordinates={addressCoordinates} />

                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
                  />

                  {/* Marker rouge pour l'adresse de livraison */}
                  {addressCoordinates && (
                    <Marker position={addressCoordinates} icon={redIcon}>
                      {!(disablePopupsOnMobile && isMobileTailwind) && (
                        <Popup>
                          <div className='min-w-[200px]'>
                            <strong>🏠 Adresse de livraison</strong>
                            <br />
                            <div className='mt-1 text-sm'>
                              {address?.line1}
                              <br />
                              {address?.line2 && (
                                <>
                                  {address.line2}
                                  <br />
                                </>
                              )}
                              {address?.postal_code} {address?.city}
                              {address?.country && <>, {address.country}</>}
                            </div>
                            <div className='mt-2 text-xs text-gray-600'>
                              <strong>Coordonnées:</strong>{' '}
                              {addressCoordinates[0].toFixed(6)},{' '}
                              {addressCoordinates[1].toFixed(6)}
                            </div>
                          </div>
                        </Popup>
                      )}
                    </Marker>
                  )}

                  {/* Markers des points relais */}
                  {filteredParcelPoints.map(pointResponse => {
                    // Vérification de sécurité
                    if (!pointResponse || !pointResponse.parcelPoint) {
                      return null;
                    }

                    const point = pointResponse.parcelPoint;
                    const distance = pointResponse.distanceFromSearchLocation;

                    // Vérification des coordonnées
                    if (!point.location || !point.location.position) {
                      return null;
                    }

                    const isSelected = selectedPoint?.code === point.code;
                    const networkIcon =
                      networkIcons[
                        point.network as keyof typeof networkIcons
                      ] || networkIcons.SOGP;

                    return (
                      <Marker
                        key={point.code}
                        position={[
                          point.location.position.latitude,
                          point.location.position.longitude,
                        ]}
                        icon={networkIcon}
                        eventHandlers={{
                          click: () => handleMarkerClick(point),
                        }}
                      >
                        {!(disablePopupsOnMobile && isMobileTailwind) && (
                          <Popup>
                            <div className='min-w-[250px]'>
                              <strong>📦 {point.name}</strong>
                              <br />
                              <div className='mt-1 text-sm'>
                                {point.location.number &&
                                  `${point.location.number} `}
                                {point.location.street}
                                <br />
                                {point.location.postalCode}{' '}
                                {point.location.city}
                                {point.location.state && (
                                  <>, {point.location.state}</>
                                )}
                              </div>
                              <div className='mt-2 text-xs text-gray-600'>
                                <strong>Code:</strong> {point.code}
                                <br />
                                <div className='flex items-center space-x-1 mt-1'>
                                  <strong>Réseau:</strong>
                                  <div
                                    className='w-3 h-3 rounded-full'
                                    style={{
                                      backgroundColor:
                                        networkConfig[
                                          point.network as keyof typeof networkConfig
                                        ]?.color || '#3B82F6',
                                    }}
                                  ></div>
                                  <span>
                                    {networkConfig[
                                      point.network as keyof typeof networkConfig
                                    ]?.name || point.network}
                                  </span>
                                </div>
                                <strong>Statut:</strong> {point.status}
                                <br />
                                <strong>Distance:</strong> {distance}m<br />
                                <div className='flex items-center space-x-1 mt-1'>
                                  <strong>
                                    Prix livraison ({selectedWeight}):
                                  </strong>
                                  <span className='text-green-600 font-semibold'>
                                    {getDeliveryPrice(point.network).toFixed(2)}
                                    €
                                  </span>
                                </div>
                                <div className='flex items-center space-x-1 mt-1'>
                                  <strong>Délai:</strong>
                                  <span className='text-blue-600 font-medium'>
                                    {getDeliveryDelay(point.network)}
                                  </span>
                                </div>
                                <div className='mt-1'>
                                  <strong>Horaires:</strong>
                                  <br />
                                  <div className='text-xs max-h-20 overflow-y-auto'>
                                    {formatOpeningHours(point.openingDays)}
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => handleMarkerClick(point)}
                                className={`mt-2 w-full px-3 py-1 text-xs rounded transition-colors ${
                                  isSelected
                                    ? 'bg-green-600 text-white cursor-default'
                                    : 'bg-gray-600 text-white hover:bg-gray-700'
                                }`}
                                disabled={isSelected}
                              >
                                {isSelected
                                  ? '✓ Point relais sélectionné'
                                  : 'Sélectionner ce point relais'}
                              </button>
                            </div>
                          </Popup>
                        )}
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>
            </>
          )}

          {deliveryType === 'HOME' && (
            /* Options de livraison à domicile */
            <div className='space-y-3 p-4'>
              <h3 className='text-lg font-medium text-gray-900 mb-4'>
                Options de livraison à domicile
              </h3>
              {Object.entries(homeDeliveryConfig).map(([key, config]) => {
                const network = key.replace('_HOME', '');
                const price = getDeliveryPrice(network, true);
                const delay = getDeliveryDelay(network, true);
                const isSelected = selectedHomeDelivery === key;

                return (
                  <div
                    key={key}
                    onClick={() => handleHomeDeliverySelect(key)}
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center space-x-3'>
                        <div
                          className='w-4 h-4 rounded-full'
                          style={{ backgroundColor: config.color }}
                        ></div>
                        <div>
                          <h4 className='text-sm font-medium text-gray-900'>
                            {config.name}
                          </h4>
                          <div className='flex items-center space-x-4 mt-1'>
                            <span className='text-xs text-blue-600 font-medium'>
                              Délai: {delay}
                            </span>
                            <span className='text-xs text-gray-500'>
                              Livraison à votre domicile
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className='text-right'>
                        <div className='text-lg font-semibold text-green-600'>
                          {price.toFixed(2)}€
                        </div>
                        <div className='text-xs text-gray-500'>
                          pour {selectedWeight}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <div className='mt-2 text-xs text-blue-600 font-medium'>
                        ✓ Option sélectionnée
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer avec informations - seulement pour les points relais */}
        {deliveryType === 'PICKUP' &&
          !loading &&
          !error &&
          parcelPoints.length > 0 && (
            <div className='px-4 py-3 bg-gray-50 border-t border-gray-200'>
              {selectedPoint ? (
                <div className='bg-white border border-green-200 rounded-lg p-3 mb-3'>
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <div className='flex items-center space-x-2 mb-2'>
                        <div
                          className='w-4 h-4 rounded-full'
                          style={{
                            backgroundColor:
                              networkConfig[
                                selectedPoint.network as keyof typeof networkConfig
                              ]?.color || '#3B82F6',
                          }}
                        ></div>
                        <h5 className='text-sm font-medium text-green-800'>
                          Point relais sélectionné
                        </h5>
                      </div>
                      <div className='text-sm text-gray-900'>
                        <strong>{selectedPoint.name}</strong>
                      </div>
                      <div className='text-xs text-gray-600 mt-1'>
                        {selectedPoint.location.number &&
                          `${selectedPoint.location.number} `}
                        {selectedPoint.location.street},{' '}
                        {selectedPoint.location.postalCode}{' '}
                        {selectedPoint.location.city}
                      </div>
                      <div className='text-xs text-gray-500 mt-1'>
                        {networkConfig[
                          selectedPoint.network as keyof typeof networkConfig
                        ]?.name || selectedPoint.network}{' '}
                        • Code: {selectedPoint.code}
                      </div>
                      <div className='flex items-center justify-between mt-2'>
                        <div className='text-sm font-semibold text-green-700'>
                          Livraison ({selectedWeight}):{' '}
                          {getDeliveryPrice(selectedPoint.network).toFixed(2)}€
                        </div>
                        <div className='text-xs text-blue-600 font-medium'>
                          Délai: {getDeliveryDelay(selectedPoint.network)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedPoint(null)}
                      className='text-gray-400 hover:text-gray-600 ml-2'
                      title='Désélectionner'
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <p className='text-xs text-gray-500'>
                  💡 Cliquez sur un marqueur pour sélectionner un point relais
                </p>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
