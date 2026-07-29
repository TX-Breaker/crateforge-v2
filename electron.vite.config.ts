import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'src/core'),
        '@services': resolve(__dirname, 'src/services'),
        '@adapters': resolve(__dirname, 'src/adapters')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    build: {
      // I font vanno emessi come FILE, mai inlineati in data: URI: la CSP del
      // renderer è `default-src 'self'` e un data:font verrebbe bloccato — con
      // il risultato silenzioso di un'app che ricade sui font di sistema.
      assetsInlineLimit: 0
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        // La ruota di Camelot e il Set Planner riusano la logica armonica già
        // testata in src/core: sono moduli TypeScript puri, senza API di Node,
        // quindi si possono bundlare nel renderer senza toccare il sandbox.
        '@core': resolve(__dirname, 'src/core')
      }
    }
  }
});
