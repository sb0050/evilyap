import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useState, useRef } from 'react';
import { createShippingOrder } from '../utils/api';
import { CreateShippingOrderRequest } from '../types/shipping';
import { Address } from '@stripe/stripe-js';

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
  shippingOfferCode: string;
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
  DLVG: new L.Icon({
    iconUrl:
      'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  }),
};

// Configuration des réseaux avec tarifs, délais et codes d'offres
const networkConfig = {
  FR: {
    SOGP: {
      name: 'Relais Colis',
      color: '#3B82F6',
      delay: '3 à 5 jours',
      shippingOfferCode: 'SOGP-RelaisColis',
    },
    MONR: {
      name: 'Mondial Relay',
      color: '#10B981',
      delay: '3 à 4 jours',
      shippingOfferCode: 'MONR-CpourToi',
    },
    CHRP: {
      name: 'Chronopost',
      color: '#F59E0B',
      delay: '2 à 4 jours',
      shippingOfferCode: 'CHRP-Chrono2ShopDirect',
    },
    COPR: {
      name: 'Colis Privé',
      color: '#8B5CF6',
      delay: '6 jours',
      disabled: false,
      shippingOfferCode: 'COPR-CoprRelaisRelaisNat',
    },
  },
  BE: {
    MONR: {
      name: 'Mondial Relay',
      color: '#10B981',
      delay: '3 jours',
      shippingOfferCode: 'MONR-CpourToiEurope',
      disabled: false,
    },
    CHRP: {
      name: 'Chronopost',
      color: '#F59E0B',
      delay: '2 à 5 jours',
      shippingOfferCode: 'CHRP-Chrono2ShopEurope',
    },
  },
};

// Configuration des options de livraison à domicile
const homeDeliveryConfig = {
  FR: {
    MONR_HOME: {
      name: 'Mondial Relay - Domicile France',
      color: '#10B981',
      delay: '5 jours',
      shippingOfferCode: 'MONR-DomicileFrance',
      disabled: false,
    },
    COPR_HOME: {
      name: 'Colis Privé - Domicile Sans Signature',
      color: '#8B5CF6',
      delay: '6 jours',
      disabled: false,
      shippingOfferCode: 'COPR-CoprRelaisDomicileNat',
    },
    COLI_HOME: {
      name: 'Colissimo - Domicile Sans Signature',
      color: '#FF6B35',
      delay: '48h',
      shippingOfferCode: 'POFR-ColissimoAccess',
      disabled: false,
    },
    CHRP_HOME: {
      name: 'Chronopost - Chrono 18 (Express)',
      color: '#F59E0B',
      delay: '24h',
      shippingOfferCode: 'CHRP-Chrono18',
      disabled: true,
    },
  },
  BE: {
    MONR_HOME: {
      name: 'Mondial Relay - Mondial Domicile Europe',
      color: '#10B981',
      delay: '3 à 6 jours',
      shippingOfferCode: 'MONR-DomicileEurope',
      disabled: false,
    },
    CHRP_HOME: {
      name: 'Chronopost - Chrono Classic',
      color: '#F59E0B',
      delay: '48h',
      shippingOfferCode: 'CHRP-ChronoInternationalClassic',
      disabled: false,
    },
    DLVG_HOME: {
      name: 'Delivengo - Delivengo easy',
      color: '#FFD60A',
      delay: '3 à 5 jours',
      shippingOfferCode: 'DLVG-DelivengoEasy',
      disabled: true,
    },
  },
  CH: {
    DLVG_HOME: {
      name: 'Delivengo - Delivengo easy',
      color: '#FFD60A',
      delay: '3 à 5 jours',
      shippingOfferCode: 'DLVG-DelivengoEasy',
      disabled: true,
    },
    FEDEX_HOME: {
      name: 'Fedex - Fedex Regional Economy',
      color: '#007AFF',
      delay: '1 à 4 jours',
      shippingOfferCode: 'FEDX-FedexRegionalEconomy',
      disabled: false,
    },
  },
};

interface ParcelPointMapProps {
  mode?: 'delivery' | 'return';
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
  storePickupAddress?: Address | null;
  storePickupPhone?: string;
  storeWebsite?: string;
  onParcelPointSelect?: (
    parcelPoint: ParcelPointData | null,
    deliveryMethod: 'home_delivery' | 'pickup_point' | 'store_pickup',
    shippingOfferCode: string | undefined
  ) => void;
  defaultDeliveryMethod?: 'home_delivery' | 'pickup_point' | 'store_pickup';
  defaultParcelPoint?: ParcelPointData | null;
  defaultParcelPointCode?: string;
  disablePopupsOnMobile?: boolean;
  initialDeliveryNetwork?: string;
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
  mode = 'delivery',
  address,
  storePickupAddress,
  storePickupPhone,
  storeWebsite,
  onParcelPointSelect,
  defaultDeliveryMethod = 'pickup_point',
  disablePopupsOnMobile = false,
  initialDeliveryNetwork,
}: ParcelPointMapProps) {
  const isReturnMode = mode === 'return';
  const [parcelPoints, setParcelPoints] = useState<ParcelPointResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<ParcelPointData | null>(
    null
  );
  const [networkFilter, setNetworkFilter] = useState<string>('ALL');
  const [deliveryType, setDeliveryType] = useState<string>(
    defaultDeliveryMethod === 'pickup_point'
      ? 'PICKUP'
      : defaultDeliveryMethod === 'store_pickup'
        ? 'STORE'
        : 'HOME'
  );
  const [selectedHomeDelivery, setSelectedHomeDelivery] = useState<string>('');
  const [isCreatingOrder, setIsCreatingOrder] = useState<boolean>(false);
  const [orderSuccess, setOrderSuccess] = useState<boolean>(false);
  const [isMobileTailwind, setIsMobileTailwind] = useState<boolean>(false);
  const [needsRefresh, setNeedsRefresh] = useState<boolean>(false);
  const [canShowRefreshMessages, setCanShowRefreshMessages] =
    useState<boolean>(true);

  // useEffect de debug pour surveiller les changements d'état
  useEffect(() => {}, [
    selectedPoint,
    selectedHomeDelivery,
    deliveryType,
    networkFilter,
  ]);

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

      const countryCodeRaw = searchAddress.country || 'FR';
      const countryCode = countryCodeRaw;
      const availableNetworks = Object.keys(
        (networkConfig as any)[countryCode] || {}
      );
      if (countryCode === 'CH' || availableNetworks.length === 0) {
        setParcelPoints([]);
        return;
      }
      const requestBody = {
        street: searchAddress.line1,
        city: searchAddress.city,
        postalCode: searchAddress.postal_code,
        countryIsoCode: countryCodeRaw,
        searchNetworks: availableNetworks.join(','),
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
      if (isReturnMode) {
        if (address) {
          fetchParcelPoints(address);
        }
        setNeedsRefresh(false);
      } else {
        setNeedsRefresh(true);
      }
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
        defaultDeliveryMethod === 'pickup_point'
          ? 'PICKUP'
          : defaultDeliveryMethod === 'store_pickup'
            ? 'STORE'
            : 'HOME'
      );
    }
    setSelectedPoint(null);
    setSelectedHomeDelivery('');
  }, [defaultDeliveryMethod]);

  useEffect(() => {
    const code = String(initialDeliveryNetwork || '').trim();
    if (!code) {
      setSelectedHomeDelivery('');
    }
  }, [initialDeliveryNetwork]);

  useEffect(() => {
    if (selectedHomeDelivery) return;
    const code = String(initialDeliveryNetwork || '').trim();
    if (!code) return;
    const countryCodeRaw = address?.country || 'FR';
    const countryKey = countryCodeRaw as keyof typeof homeDeliveryConfig;
    const cfgByKey = (homeDeliveryConfig as any)[countryKey] || {};
    const target = code.toUpperCase();
    const matchKey = Object.keys(cfgByKey).find(k => {
      const offer = String(cfgByKey?.[k]?.shippingOfferCode || '').trim();
      return offer && offer.toUpperCase() === target;
    });
    if (matchKey && cfgByKey?.[matchKey]?.disabled !== true) {
      setSelectedHomeDelivery(matchKey);
    }
  }, [address?.country, initialDeliveryNetwork, selectedHomeDelivery]);

  useEffect(() => {
    if (address?.country === 'CH' && deliveryType === 'PICKUP') {
      setDeliveryType('HOME');
    }
  }, [address?.country, deliveryType]);

  useEffect(() => {
    const countryCodeRaw = address?.country || 'FR';
    const countryCode = countryCodeRaw;
    const keys = Object.keys((networkConfig as any)[countryCode] || {});
    if (networkFilter !== 'ALL' && !keys.includes(networkFilter)) {
      setNetworkFilter('ALL');
    }
  }, [address?.country]);

  // Gestion de la sélection d'un point relais
  const handleMarkerClick = (parcelPoint: ParcelPointData) => {
    setSelectedPoint(parcelPoint);
    const countryCodeRaw = address?.country || 'FR';
    const countryCode = countryCodeRaw;
    const shippingOfferCode = (networkConfig as any)[countryCode]?.[
      parcelPoint.network
    ]?.shippingOfferCode;

    if (onParcelPointSelect) {
      onParcelPointSelect(parcelPoint, 'pickup_point', shippingOfferCode);
    }
  };

  // Gestion du changement de type de livraison
  const handleDeliveryTypeChange = (type: string) => {
    setDeliveryType(type);

    if (type === 'HOME') {
      setSelectedPoint(null);
      setSelectedHomeDelivery('');
      if (onParcelPointSelect) {
        onParcelPointSelect(null, 'home_delivery', undefined);
      }
    } else if (type === 'PICKUP') {
      setSelectedHomeDelivery('');
      setSelectedPoint(null);
      if (onParcelPointSelect) {
        onParcelPointSelect(null, 'pickup_point', undefined);
      }
    } else if (type === 'STORE') {
      setSelectedHomeDelivery('');
      setSelectedPoint(null);
      if (onParcelPointSelect) {
        onParcelPointSelect(null, 'store_pickup', undefined);
      }
    }
  };

  // Gestion de la sélection d'une option de livraison à domicile
  const handleHomeDeliverySelect = (deliveryKey: string) => {
    const countryCodeRaw = address?.country || 'FR';
    const countryKey = countryCodeRaw as keyof typeof homeDeliveryConfig;
    const config = (homeDeliveryConfig as any)[countryKey]?.[deliveryKey];
    if (config?.disabled) {
      return;
    }
    setSelectedHomeDelivery(deliveryKey);
    const baseNetwork = String(deliveryKey).replace('_HOME', '');
    const shippingOfferCode = config?.shippingOfferCode;

    if (onParcelPointSelect) {
      onParcelPointSelect(null, 'home_delivery', shippingOfferCode);
    }
  };

  // Filtrer les points relais selon le réseau sélectionné (sans UPS et DHL)
  const filteredParcelPoints = parcelPoints.filter(pointResponse => {
    const network = pointResponse.parcelPoint.network;
    // Exclure UPS, DHL et Colis Privé
    if (network === 'UPSE' || network === 'DHLE') return false;
    if (networkFilter === 'ALL') return true;
    return network === networkFilter;
  });

  // Obtenir le délai de livraison
  const getDeliveryDelay = (
    network: string,
    isHomeDelivery: boolean = false
  ): string => {
    const countryCodeRaw = address?.country || 'FR';
    const countryCode = countryCodeRaw;
    if (isHomeDelivery) {
      const homeKey = `${network}_HOME`;
      const config = (homeDeliveryConfig as any)[countryCode]?.[homeKey];
      return config?.delay || '';
    } else {
      const config = (networkConfig as any)[countryCode]?.[network];
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
              {isReturnMode ? 'Choisir son retour' : 'Choisir sa livraison'}
            </h4>
          </div>

          {/* Filtres */}
          <div className='space-y-3 mb-3'>
            {/* Première ligne : Type de livraison */}
            <div className='flex items-center space-x-4'>
              <label className='text-xs font-medium text-gray-700'>
                {isReturnMode ? 'Type de retour:' : 'Type de livraison:'}
              </label>
              <div className='flex space-x-4'>
                <label className='flex items-center space-x-1'>
                  <input
                    type='radio'
                    name='deliveryType'
                    value='PICKUP'
                    checked={deliveryType === 'PICKUP'}
                    onChange={e => handleDeliveryTypeChange(e.target.value)}
                    disabled={address?.country === 'CH'}
                    className='text-blue-600'
                  />
                  <span className='text-xs text-gray-700'>
                    {isReturnMode ? 'Point de relais' : 'Point relais'}
                  </span>
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
                <label className='flex items-center space-x-1'>
                  <input
                    type='radio'
                    name='deliveryType'
                    value='STORE'
                    checked={deliveryType === 'STORE'}
                    onChange={e => handleDeliveryTypeChange(e.target.value)}
                    className='text-blue-600'
                  />
                  <span className='text-xs text-gray-700'>
                    {isReturnMode ? 'Retour au magasin' : 'Retrait en magasin'}
                  </span>
                </label>
              </div>
            </div>

            {/* Deuxième ligne : Filtres et poids */}
            <div className='flex items-center flex-wrap gap-4'>
              {deliveryType === 'PICKUP' && (
                <div className='flex-1'>
                  <div className='text-xs font-medium text-gray-700'>
                    {isReturnMode
                      ? 'Choisis le réseau de retour'
                      : 'Choisis le réseau de livraison'}
                  </div>
                  <div className='mt-2 space-y-2'>
                    <label className='flex items-center justify-between p-3 bg-white border border-gray-300 rounded'>
                      <div>
                        <div className='text-sm font-medium text-gray-900'>
                          Tous les réseaux
                        </div>
                        <div className='text-xs text-gray-600'>
                          {isReturnMode
                            ? 'Affiche tous les points de relais disponibles.'
                            : 'Affiche tous les points relais disponibles.'}
                        </div>
                      </div>
                      <input
                        type='radio'
                        name='networkFilter'
                        value='ALL'
                        checked={networkFilter === 'ALL'}
                        onChange={e => setNetworkFilter(e.target.value)}
                      />
                    </label>
                    {Object.entries(
                      (networkConfig as any)[
                        (address?.country || 'FR') as keyof typeof networkConfig
                      ] || {}
                    ).map(([key, cfg]: any) => (
                      <label
                        key={key}
                        className='flex items-center justify-between p-3 bg-white border border-gray-300 rounded'
                      >
                        <div>
                          <div className='text-sm font-medium text-gray-900'>
                            {cfg.name}
                          </div>
                        </div>
                        <input
                          type='radio'
                          name='networkFilter'
                          value={key}
                          checked={networkFilter === key}
                          onChange={e => setNetworkFilter(e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Légende */}
          {deliveryType === 'PICKUP' && (
            <div className='flex flex-wrap items-center gap-3 text-xs mb-3'>
              <div className='flex items-center space-x-1'>
                <div className='w-3 h-3 bg-red-500 rounded-full'></div>
                <span className='text-gray-600'>
                  {isReturnMode ? 'Adresse magasin' : 'Votre adresse'}
                </span>
              </div>
              {Object.entries(
                (networkConfig as any)[
                  (address?.country || 'FR') as keyof typeof networkConfig
                ] || {}
              ).map(([key, cfg]: any) => (
                <div key={key} className='flex items-center space-x-1'>
                  <div
                    className='w-3 h-3 rounded-full'
                    style={{ backgroundColor: cfg.color }}
                  ></div>
                  <span className='text-gray-600'>{cfg.name}</span>
                </div>
              ))}
            </div>
          )}

          {deliveryType === 'STORE'
            ? storePickupAddress && <div></div>
            : address && (
                <div className='flex items-start justify-between gap-3'>
                  <p className='text-xs text-gray-600'>
                    <strong>
                      {isReturnMode ? 'Adresse magasin : ' : 'Votre adresse : '}
                    </strong>
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''},{' '}
                    {address.postal_code} {address.city}
                    {address.country ? `, ${address.country}` : ''}
                  </p>
                  <div className='flex items-center justify-end gap-3'>
                    <div className='flex items-center space-x-2 text-xs text-gray-500'>
                      {loading && (
                        <span className='text-blue-600'>🔄 Chargement...</span>
                      )}
                      {error && <span className='text-red-600'>❌ Erreur</span>}
                    </div>
                    {!loading && (
                      <button
                        onClick={handleManualRefresh}
                        className='px-4 py-2 text-sm rounded border transition-colors bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                      >
                        🔄 Rafraîchir
                      </button>
                    )}
                  </div>
                </div>
              )}
        </div>

        {/* Contenu principal */}
        <div className='relative'>
          {deliveryType === 'STORE' && (
            <div className='px-4 py-3 bg-gray-50 border-t border-gray-200'>
              <div className='bg-white border border-gray-200 rounded-lg p-4 shadow-sm'>
                <h5 className='text-lg font-medium text-gray-900 mb-4'>
                  {isReturnMode ? 'Retour au magasin' : 'Retrait en magasin'}
                </h5>
                <div className='text-sm text-gray-700'>
                  {storePickupAddress ? (
                    <p>
                      <strong>Adresse:</strong> {storePickupAddress.line1}
                      {storePickupAddress.line2
                        ? `, ${storePickupAddress.line2}`
                        : ''}
                      , {storePickupAddress.postal_code}{' '}
                      {storePickupAddress.city}
                      {storePickupAddress.country
                        ? `, ${storePickupAddress.country}`
                        : ''}
                    </p>
                  ) : (
                    <p className='text-red-600'>
                      Adresse du magasin indisponible.
                    </p>
                  )}
                  {storePickupPhone && (
                    <p>
                      <strong>Téléphone:</strong> {storePickupPhone}
                    </p>
                  )}
                  <div className='flex items-center space-x-4 mt-2'>
                    <div className='text-blue-600'>
                      {storeWebsite && (
                        <>
                          {'Infos sur la boutique:   '}
                          <a
                            href={
                              storeWebsite.startsWith('http')
                                ? storeWebsite
                                : `https://${storeWebsite}`
                            }
                            target='_blank'
                            rel='noopener noreferrer'
                            className='text-blue-600 hover:text-blue-800 underline'
                          >
                            {storeWebsite}
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
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

              <div
                className='relative'
                style={{ height: '400px', width: '100%' }}
              >
                {needsRefresh && canShowRefreshMessages && (
                  <div className='absolute inset-0 z-[1000] flex items-center justify-center bg-white/80 backdrop-blur-sm'>
                    <button
                      onClick={handleManualRefresh}
                      disabled={loading}
                      className={`px-4 py-2 text-sm rounded border transition-colors ${
                        loading
                          ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                          : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      🔄 Rafraîchir
                    </button>
                  </div>
                )}
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
                            <strong>
                              {isReturnMode
                                ? '🏬 Adresse magasin'
                                : '🏠 Adresse de livraison'}
                            </strong>
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
                                        (networkConfig as any)[
                                          (address?.country ||
                                            'FR') as keyof typeof networkConfig
                                        ]?.[point.network]?.color || '#3B82F6',
                                    }}
                                  ></div>
                                  <span>
                                    {(networkConfig as any)[
                                      (address?.country ||
                                        'FR') as keyof typeof networkConfig
                                    ]?.[point.network]?.name || point.network}
                                  </span>
                                </div>
                                <strong>Statut:</strong> {point.status}
                                <br />
                                <strong>Distance:</strong> {distance}m<br />
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
                                  ? isReturnMode
                                    ? '✓ Point de relais sélectionné'
                                    : '✓ Point relais sélectionné'
                                  : isReturnMode
                                    ? 'Sélectionner ce point de relais'
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
                {isReturnMode
                  ? 'Options de retour à domicile'
                  : 'Options de livraison à domicile'}
              </h3>
              {Object.entries(
                (homeDeliveryConfig as any)[
                  (address?.country || 'FR') as keyof typeof homeDeliveryConfig
                ] || {}
              )
                .filter(([, cfg]) => (cfg as any)?.disabled !== true)
                .map(([key, config]: any) => {
                  const network = key.replace('_HOME', '');
                  const delay = getDeliveryDelay(network, true);
                  const isSelected = selectedHomeDelivery === key;
                  const isDisabled = !!config.disabled;

                  return (
                    <div
                      key={key}
                      onClick={
                        isDisabled
                          ? undefined
                          : () => handleHomeDeliverySelect(key)
                      }
                      className={`border rounded-lg p-4 ${isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : isDisabled
                            ? 'border-gray-200'
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
                      </div>
                      {isDisabled && (
                        <div className='mt-2 text-xs text-gray-500 font-medium'>
                          Indisponible pour le moment
                        </div>
                      )}
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
                              (networkConfig as any)[
                                (address?.country ||
                                  'FR') as keyof typeof networkConfig
                              ]?.[selectedPoint.network]?.color || '#3B82F6',
                          }}
                        ></div>
                        <h5 className='text-sm font-medium text-green-800'>
                          {isReturnMode
                            ? 'Point de relais sélectionné'
                            : 'Point relais sélectionné'}
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
                        {(networkConfig as any)[
                          (address?.country ||
                            'FR') as keyof typeof networkConfig
                        ]?.[selectedPoint.network]?.name ||
                          selectedPoint.network}{' '}
                        • Code: {selectedPoint.code}
                      </div>
                      <div className='flex items-center justify-between mt-2'>
                        <div className='text-xs text-blue-600 font-medium'>
                          Délai: {getDeliveryDelay(selectedPoint.network)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedPoint(null);
                        if (onParcelPointSelect) {
                          onParcelPointSelect(null, 'pickup_point', undefined);
                        }
                      }}
                      className='text-gray-400 hover:text-gray-600 ml-2'
                      title='Désélectionner'
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <p className='text-xs text-gray-500'>
                  💡 Cliquez sur un marqueur pour sélectionner un point{' '}
                  {isReturnMode ? 'de relais' : 'relais'}
                </p>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
