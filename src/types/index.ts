// Address types
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal_code: string;
  country: string;
}

// Parcel Point types
export interface ParcelPoint {
  id: string;
  name: string;
  address: Address;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  network: string;
  distance?: number;
  openingHours?: string[];
  services?: string[];
  phone?: string;
}

// Boxtal Map component props
export interface BoxtalMapProps {
  deliveryAddress: Address;
  onParcelPointSelect: (point: ParcelPoint) => void;
  networks?: string[];
  maxResults?: number;
  height?: string;
  onError?: () => void;
}

// Stripe types
export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  client_secret: string;
}

// Order types
export interface Order {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  shipping_address: Address;
  parcel_point?: ParcelPoint;
}

// User types
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Boxtal Service types
export interface BoxtalAuthResponse {
  access_token: string;
  token: string;
  expires_in: number;
  token_type: string;
}

export interface BoxtalParcelPointsResponse {
  parcel_points: ParcelPoint[];
  total: number;
}
