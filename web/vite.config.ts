import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// The API (Ask, catalog, pack downloads) is proxied in dev; in production the
// FastAPI app can serve this build, or set VITE_API_BASE at build time.
const API = process.env.ZS_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "ZeroSignal",
        short_name: "ZeroSignal",
        description: "No signal. Still an answer. Offline emergency, survival and vehicle guidance.",
        theme_color: "#b3261e",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // App shell + bundled knowledge packs are precached, so the whole app
        // (library, search, protocol cards, tools) works in airplane mode.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}", "packs/*.json"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/packs\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/packs/": {
        target: API,
        changeOrigin: true,
        // Bundled pack JSON is served by Vite from public/; only sqlite/sig go to the API.
        bypass: (req) => (req.url && /\.json$/.test(req.url) ? req.url : undefined),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
