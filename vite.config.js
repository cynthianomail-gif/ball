import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// build 會輸出單一 dist/index.html，雙擊就能玩，也能直接上傳到任何網頁空間
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
});
