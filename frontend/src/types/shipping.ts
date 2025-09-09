// Types pour les commandes d'expédition Boxtal

export interface Contact {
  email: string;
  phone: string;
  company?: string;
  lastName: string;
  firstName: string;
}

export interface Position {
  latitude: string;
  longitude: string;
}

export interface Location {
  city: string;
  state?: string;
  number?: string;
  street: string;
  position?: Position;
  postalCode: string;
  countryIsoCode: string;
}

export interface Address {
  type: 'BUSINESS' | 'RESIDENTIAL';
  contact: Contact;
  location: Location;
  additionalInformation?: string;
}

export interface Value {
  value: number;
  currency: 'EUR';
}

export interface Content {
  id: string;
  description: string;
}

export interface Package {
  type: 'PARCEL' | 'LETTER' | 'PALLET';
  value: Value;
  width: number;
  height?: number;
  length: number;
  weight: number;
  content: Content;
  stackable?: boolean;
  externalId?: string;
}

export interface Article {
  quantity: number;
  unitValue: Value;
  unitWeight: number;
  description: string;
  tariffNumber?: string;
  originCountry: string;
  packageExternalId?: string;
}

export interface CustomsDeclaration {
  reason:
    | 'SALE'
    | 'REPAIR'
    | 'RETURN'
    | 'GIFT'
    | 'SAMPLE'
    | 'DOCUMENTS'
    | 'PERSONAL_USE'
    | 'OTHER';
  articles: Article[];
}

export interface Shipment {
  packages: Package[];
  toAddress: Address;
  externalId?: string;
  fromAddress: Address;
  returnAddress?: Address;
  pickupPointCode?: string;
  dropOffPointCode?: string;
  customsDeclaration?: CustomsDeclaration;
}

export interface CreateShippingOrderRequest {
  insured?: boolean;
  shipment: Shipment;
  labelType?: 'PDF_A4' | 'PDF_10x15';
  shippingOfferId?: string;
  shippingOfferCode?: string;
  expectedTakingOverDate?: string;
}

export interface ShippingOrderResponse {
  id: string;
  status: string;
  trackingNumber?: string;
  labelUrl?: string;
  // Autres champs de réponse selon l'API Boxtal
}
