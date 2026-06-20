import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// E2E 测试配置：需要真实 LLM API，CI 可选跑
// 运行：MINIMEM_LLM_API_KEY=xxx pnpm test:e2e
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    passWithNoTests: true,
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
