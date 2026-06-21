// ============================================================
// MiniMem — src/index.ts (A01: 改为 re-export app/main)
// ============================================================
// 入口文件保持向后兼容：
// - package.json 的 main/bin 仍指向 dist/index.js
// - 实际逻辑在 src/app/main.ts
// - pnpm dev / pnpm start 仍然可用

export { startMinimem } from './app/main.js';
