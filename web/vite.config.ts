import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const BACKEND = "http://127.0.0.1:4317";

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
        // This is a live dashboard, not an offline-first content app: never
        // let the service worker cache API calls or WebSocket upgrades.
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
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
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
});
