import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(process.cwd(), "web"),
  publicDir: path.resolve(process.cwd(), "web/public"),
  // 配置代理，把 /api 请求转发到后端
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:6727',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist/public"),
    emptyOutDir: true,
    // 代码分割优化
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 react 相关代码单独打包
          'react-vendor': ['react', 'react-dom'],
          // 将 lucide-react 图标库单独打包
          'icons': ['lucide-react'],
        }
      }
    },
    // 启用压缩
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // 生产环境移除 console
        drop_debugger: true,
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
  },
});