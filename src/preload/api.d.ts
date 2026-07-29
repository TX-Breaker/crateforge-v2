import type { CrateForgeApi } from './index';

declare global {
  interface Window {
    crateforge: CrateForgeApi;
  }
}

export {};
