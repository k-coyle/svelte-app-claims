import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss(), devtoolsJson()],
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,js}', 'src/**/*.{test,spec}.{ts,js}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: { provider: 'v8', reportsDirectory: 'coverage' }
  }
});
