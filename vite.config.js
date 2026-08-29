import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    minify: 'esbuild',
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'Fractal',
      formats: ['es', 'umd'],
      fileName: (format) => `fractal.${format === 'es' ? 'js' : 'umd.cjs'}`,
    },
  },
});

