/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NATIVE_AI_UI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
