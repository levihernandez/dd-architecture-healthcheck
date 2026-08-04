/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DD_RUM_APP_ID: string;
  readonly VITE_DD_RUM_CLIENT_TOKEN: string;
  readonly VITE_DD_SERVICE: string;
  readonly VITE_DD_ENV: string;
  readonly VITE_DD_VERSION: string;
  readonly VITE_DD_SITE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
