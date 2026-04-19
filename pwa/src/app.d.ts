/// <reference types="@sveltejs/kit" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_POLYGON_IO_KEY?: string;
  readonly VITE_POLYGON_API_KEY?: string;
  readonly VITE_MOCK_SENTIMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  namespace App {}
}

export {};
