import {
  Address,
  BoxtalAuthResponse,
  BoxtalParcelPointsResponse,
} from '../types';

const BOXTAL_AUTH_ENDPOINT = `${
  process.env.REACT_APP_API_URL || 'http://localhost:5000'
}/api/boxtal/auth`;

class BoxtalService {
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  /**
   * Obtenir un token d'accès pour l'API Boxtal
   */
  async getAccessToken(): Promise<string> {
    // Vérifier si le token est encore valide
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      // Utiliser GET au lieu de POST selon la nouvelle structure
      const response = await fetch(BOXTAL_AUTH_ENDPOINT, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorData.error}`
        );
      }

      const data: BoxtalAuthResponse = await response.json();

      if (data.access_token || data.token) {
        this.accessToken = data.access_token || data.token;
        // Définir l'expiration du token
        this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
        return this.accessToken;
      } else {
        throw new Error('No access token received');
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error getting Boxtal access token:', error);
      throw error;
    }
  }

  /**
   * Rechercher des points relais
   */
  async searchParcelPoints(
    address: Address,
    networks: string[] = ['SOGP', 'MONR', 'CHRP']
  ): Promise<BoxtalParcelPointsResponse> {
    try {
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';

      const response = await fetch(`${apiUrl}/api/boxtal/parcel-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address: address.line1 || '',
          zipcode: address.postal_code || '',
          city: address.city || '',
          country: address.country || 'FR',
          networks: networks,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorData.error}`
        );
      }

      return await response.json();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error searching parcel points:', error);
      throw error;
    }
  }

  /**
   * Charger le SDK Boxtal Maps
   */
  loadBoxtalMapsSDK(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Vérifier si le SDK est déjà chargé
      if ((window as any).BoxtalParcelPointMap) {
        resolve((window as any).BoxtalParcelPointMap);
        return;
      }

      // Créer le script tag avec la bonne URL
      const script = document.createElement('script');
      script.src =
        'https://maps.boxtal.com/app/v3/assets/dependencies/@boxtal/parcel-point-map/dist/index.global.js';
      script.async = true;

      script.onload = () => {
        if ((window as any).BoxtalParcelPointMap) {
          resolve((window as any).BoxtalParcelPointMap);
        } else {
          reject(new Error('BoxtalParcelPointMap SDK failed to load'));
        }
      };

      script.onerror = () => {
        reject(new Error('Failed to load BoxtalParcelPointMap SDK'));
      };

      document.head.appendChild(script);
    });
  }
}

// Instance singleton
const boxtalService = new BoxtalService();

export default boxtalService;
