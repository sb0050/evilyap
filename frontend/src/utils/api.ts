// Configuration centralisée pour les appels API
/// <reference types="vite/client" />

// Fonction pour détecter l'URL de l'API
const normalizeBaseUrl = (raw?: string) => {
  const val = (raw || '').trim();
  if (!val) return 'http://localhost:5000';
  // Support des formats ":5000" ou "localhost:5000" sans schéma
  if (val.startsWith(':')) return `http://localhost${val}`;
  if (!/^https?:\/\//i.test(val)) return `http://${val}`;
  return val;
};

const getApiBaseUrl = () => {
  // Si on est en mode ngrok (npm run dev:ngrok), utiliser l'URL du backend ngrok depuis les variables d'environnement
  const isNgrok = (window.location.hostname.includes('ngrok') ||
    window.location.hostname.includes('ngrok-free.app')) &&
    import.meta.env.VITE_USE_NGROK === 'true';

  const raw = isNgrok
    ? (import.meta.env.VITE_API_URL_NGROK || import.meta.env.VITE_API_URL || 'http://localhost:5000')
    : (import.meta.env.VITE_API_URL || 'http://localhost:5000');

  return normalizeBaseUrl(raw);
};

const API_BASE_URL = getApiBaseUrl();

// Debug: Afficher l'URL API utilisée
console.log('🔧 API Base URL:', API_BASE_URL);
console.log('🌐 Current hostname:', window.location.hostname);
console.log('📍 Environment variables:', {
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_API_URL_NGROK: import.meta.env.VITE_API_URL_NGROK,
});

/**
 * Utilitaire pour faire des appels API avec la bonne URL de base
 */
export const apiCall = async (endpoint: any, options: any = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const finalOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, finalOptions);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  } catch (error) {
    console.error(`API call failed for ${endpoint}:`, error);
    throw error;
  }
};

/**
 * Raccourci pour les appels GET
 */
export const apiGet = (endpoint: any, options = {}) => {
  return apiCall(endpoint, { ...options, method: 'GET' });
};

/**
 * Raccourci pour les appels POST
 */
export const apiPost = (endpoint: any, data: any, options = {}) => {
  return apiCall(endpoint, {
    ...options,
    method: 'POST',
    body: JSON.stringify(data),
  });
};

/**
 * Raccourci pour les appels PUT
 */
export const apiPut = (endpoint: any, data: any, options = {}) => {
  return apiCall(endpoint, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

/**
 * Raccourci pour les appels DELETE
 */
export const apiDelete = (endpoint: any, options = {}) => {
  return apiCall(endpoint, { ...options, method: 'DELETE' });
};

/**
 * Raccourci pour POST de FormData (ne pas définir Content-Type)
 */
export const apiPostForm = async (endpoint: any, formData: FormData, options: any = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  const finalOptions = {
    method: 'POST',
    body: formData,
    // Ne pas fixer Content-Type pour laisser le navigateur gérer le boundary
    headers: {
      ...(options.headers || {}),
    },
    ...options,
  };
  const response = await fetch(url, finalOptions);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP error! status: ${response.status} - ${text}`);
  }
  return response;
};

// API Boxtal
export const createShippingOrder = (orderData: any) => {
  return apiPost('/api/boxtal/shipping-orders', orderData);
};

export { API_BASE_URL };
