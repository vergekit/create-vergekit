import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import favicons from 'astro-favicons';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  // Keep metadata in Favicon.astro; installable-app assets can be enabled here later.
  integrations: [
    favicons({
      input: 'public/favicon.svg',
      background: '#fff',
      icons: {
        android: false,
        appleIcon: ['apple-touch-icon.png'],
        appleStartup: false,
        favicons: ['favicon.ico'],
        windows: false,
        yandex: false,
      },
      output: {
        html: false,
      },
      withCapo: false,
    }),
  ],
  security: {
    checkOrigin: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
