import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯静态产物：构建为静态文件，由容器内静态服务器（带健康检查）发布。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
