import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Bungie only allows HTTPS redirect URLs, so the dev server runs HTTPS on 5443
// (the Redirect URL on the Bungie app) and forwards auth and API calls to the
// local API server on 5444.
const api = 'http://127.0.0.1:5444';

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: 5443,
    strictPort: true,
    proxy: { '/api': api, '/auth': api },
  },
});
