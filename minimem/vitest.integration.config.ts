import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Integration 测试配置：内存 sqlite + mock LLM，CI 强制跑
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
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
