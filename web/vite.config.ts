import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const BACKEND = "http://127.0.0.1:4317";

// mermaid (and its diagram-renderer deps: d3, dagre, cytoscape, katex, ...)
// is only ever reached via the dynamic import() in EmmyMermaid.tsx, loaded
// on demand when a chat actually contains a ```mermaid block. Force it into
// one predictably-named chunk so the PWA precache list below can exclude it
// by name — otherwise workbox's default globPatterns would precache all of
// mermaid's ~4MB of diagram-type chunks into the service worker on every
// visit, even for users who never see a diagram.
const MERMAID_CHUNK_DEPS = /node_modules\/(mermaid|d3-?|dagre|dagre-d3-es|khroma|cytoscape|cose-base|cose-bilkent|layout-base|katex|marked|dompurify|roughjs|elkjs|@mermaid-js|langium|chevrotain|ts-dedent|internmap|delaunator|robust-predicates|uuid)\//;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Overlay",
        short_name: "Overlay",
        description: "Bedienoberfläche zur Verwaltung des Homeservers und der Web-Apps",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0e14",
        theme_color: "#0b0e14",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Keep mermaid's on-demand chunk out of the install-time precache
        // (see MERMAID_CHUNK_DEPS above) — it's still runtime-cached the
        // first time a diagram actually renders, via the CacheFirst rule below.
        globIgnores: ["**/mermaid-vendor-*.js"],
        // This is a live dashboard, not an offline-first content app: never
        // let the service worker cache API calls or WebSocket upgrades.
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/x\//],
        // ...and never answer a *navigation* from the precache either.
        //
        // Overlay can sit behind an auth portal (Authelia, see
        // docs/DEPLOYMENT.md section 9) whose session expires on its own
        // schedule — `inactivity: 15m` in the shipped config. The portal
        // signals that by redirecting a navigation to its login page, and a
        // service worker that serves index.html from cache swallows exactly
        // that redirect: the shell reappears offline-style, every API call is
        // rejected by the portal, and no amount of reloading ever gets the
        // user to the login form. Both keys matter — navigateFallback is the
        // explicit fallback route, directoryIndex is what makes a navigation
        // to "/" match the precached "/index.html" entry.
        navigateFallback: undefined,
        directoryIndex: null,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            // The program dashboards are reverse-proxied live under /x/… —
            // the service worker must never cache or shortcut these (a stale
            // or precache-matched response renders as a broken iframe).
            urlPattern: /^\/x\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /\/assets\/mermaid-vendor-.*\.js$/,
            handler: "CacheFirst",
            options: { cacheName: "mermaid-vendor", expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (MERMAID_CHUNK_DEPS.test(id)) return "mermaid-vendor";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
});
