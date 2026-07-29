import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@services': resolve(__dirname, 'src/services'),
      '@adapters': resolve(__dirname, 'src/adapters')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000
  }
});
