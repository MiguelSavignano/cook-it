import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cook-It frontend (Picker "/" + Cook "/cook", one SPA -- see src/api.py's
// catch-all route). FastAPI serves whatever `npm run build` writes to
// ../static_dist -- there's no dev/prod split in *what* gets served, only
// in whether you're running `npm run dev` (fast iteration, proxies /api/*
// to the FastAPI backend) or the built output (the real deployed thing,
// same as a Raspberry Pi kiosk browser would load).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../static_dist',
    emptyOutDir: true,
    // Keeps hashed JS/CSS bundles out of public/assets/ (the face SVGs --
    // see public/assets/README.md) so the two don't share a directory.
    assetsDir: 'bundle',
  },
  server: {
    proxy: {
      // run_web.sh's uvicorn is HTTPS-only with a self-signed cert (see
      // that script -- getUserMedia needs it off localhost); `secure:
      // false` here just means "don't verify that cert", not "use HTTP".
      '/api': { target: 'https://localhost:3000', secure: false },
    },
  },
})
