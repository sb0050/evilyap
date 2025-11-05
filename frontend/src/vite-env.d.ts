/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly CLERK_PUBLISHABLE_KEY: string;
  readonly STRIPE_PUBLISHABLE_KEY: string;
  readonly API_URL: string;
  readonly GOOGLE_MAPS_API_KEY: string;
  // Ajoutez d'autres variables d'environnement ici
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
