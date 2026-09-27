/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE?: string;
  readonly VITE_DEFAULT_REPO_OWNER?: string;
  readonly VITE_DEFAULT_REPO_NAME?: string;
  readonly VITE_METADATA_PROVIDER?: 'jina' | 'allorigins' | 'custom';
  readonly VITE_METADATA_CUSTOM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
