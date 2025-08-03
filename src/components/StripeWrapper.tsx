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
  // Create properly typed options based on whether clientSecret is provided
  const elementsOptions: StripeElementsOptions = clientSecret
    ? {
        clientSecret,
        // When using clientSecret, only merge appearance and other compatible options
        // paymentMethodTypes is handled automatically by the Payment Intent
        ...Object.fromEntries(
          Object.entries(options).filter(
            ([key]) => key !== 'mode' && key !== 'paymentMethodTypes'
          )
        ),
      }
    : {
        // When not using clientSecret, use minimal safe options
        mode: 'payment',
        currency: 'eur',
        amount: 1000, // 10€ par défaut
        paymentMethodTypes: ['card'],
        // Merge with provided options
        ...Object.fromEntries(
          Object.entries(options).filter(([key]) => key !== 'clientSecret')
        ),
      };

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      {children}
    </Elements>
  );
}
