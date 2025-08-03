// Configuration centralisée pour les appels API
/// <reference types="vite/client" />

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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

// API Boxtal
export const createShippingOrder = (orderData: any) => {
  return apiPost('/api/boxtal/shipping-orders', orderData);
};

export { API_BASE_URL };
