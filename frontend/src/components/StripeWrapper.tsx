import React from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!);

interface StripeWrapperProps {
  children: React.ReactNode;
  clientSecret?: string;
  options?: Partial<StripeElementsOptions>;
}

export default function StripeWrapper({
  children,
  clientSecret,
  options = {},
}: StripeWrapperProps) {
  // Default appearance to increase input height and readability
  const defaultAppearance: StripeElementsOptions['appearance'] = {
    theme: 'stripe',
    variables: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto',
      fontSizeBase: '16px',
      borderRadius: '8px',
      spacingUnit: '8px',
      colorPrimary: '#334155',
    },
    rules: {
      '.Input': {
        padding: '14px 12px',
        lineHeight: '1.5',
      },
      '.Input--invalid': {
        borderColor: '#ef4444', // rouge Tailwind 500
      },
      '.Label': {
        fontSize: '14px',
      },
    },
  };

  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  // Build elements options, merging defaults and incoming options
  const elementsOptions: StripeElementsOptions = clientSecret
    ? {
        clientSecret,
        appearance: {
          ...defaultAppearance,
          ...(options.appearance || {}),
        },
        ...(googleMapsApiKey ? { googleMapsApiKey } : {}),
      }
    : {
        // Ensure LinkAuthenticationElement requirements: provide mode/currency/amount
        mode: (options as any)?.mode || 'payment',
        currency: (options as any)?.currency || 'eur',
        amount: (options as any)?.amount || 1000,
        appearance: {
          ...defaultAppearance,
          ...(options.appearance || {}),
        },
        ...(googleMapsApiKey ? { googleMapsApiKey } : {}),
      };

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      {children}
    </Elements>
  );
}
