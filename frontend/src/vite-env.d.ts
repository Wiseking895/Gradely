/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Gradely API, e.g. https://gradely-api.vercel.app */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
