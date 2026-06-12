import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@store': resolve(__dirname, 'src/store'),
      '@core': resolve(__dirname, 'src/core'),
      '@gateway': resolve(__dirname, 'src/gateway'),
      '@retrieval': resolve(__dirname, 'src/retrieval'),
      '@llm': resolve(__dirname, 'src/llm'),
      '@common': resolve(__dirname, 'src/common'),
    },
  },
});
