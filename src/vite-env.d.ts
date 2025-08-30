/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_API_URL: string;
  readonly VITE_API_URL_NGROK: string;
  readonly VITE_GOOGLE_MAPS_API_KEY: string;
  readonly VITE_NGROK_AUTH_TOKEN: string;
  // Ajoutez d'autres variables d'environnement ici
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
