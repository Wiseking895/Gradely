import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Vitest runs the React component tests in jsdom. Tailwind is not needed for
 * behaviour tests (class names are not asserted), so only the React plugin is
 * loaded here; the production build keeps using vite.config.ts.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
