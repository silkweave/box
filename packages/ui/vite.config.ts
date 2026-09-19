import { defineConfig, defaultClientConditions } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// Only Storybook builds this package - the library itself ships as TS source through the
// `@silkweave/box-source` export condition (tsdown builds build/ on prepack/CI). Tailwind runs here
// so stories render against the real token pipeline, not an approximation of it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['@silkweave/box-source', ...defaultClientConditions] },
})
