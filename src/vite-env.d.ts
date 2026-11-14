/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NATIVE_AI_UI?: string;
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_TIKTOK_PIXEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
