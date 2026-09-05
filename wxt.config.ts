import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    name: 'Telegram Media Archiver',
    description: 'Archives photos, videos and other media from the Telegram Web chat you have open.',
    permissions: ['activeTab', 'sidePanel'],
    host_permissions: ['https://web.telegram.org/*'],
    // Icons live in public/ (copied verbatim into the build output), not
    // assets/ (Vite-processed, only emitted if something imports it) —
    // a manifest icon path is never imported, so assets/ silently drops it
    // and Chrome fails to load the extension with no icon shown at all.
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
});
