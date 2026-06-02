import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";

/**
 * Vite configuration for VeteranLedger multi-page archive.
 *
 * This config supports:
 * - Multi-page HTML entry points (preserving all existing pages)
 * - CSS/JS modular architecture from src/
 * - Static assets served from public/
 * - Legacy fallback for original .js data files
 * - Production builds optimized for archival platform
 *
 * IMPORTANT:
 * - All original HTML files remain untouched
 * - Original data files (.js) in data/ are NOT moved
 * - Images are NOT moved until explicitly configured
 * - This is a parallel migration workspace
 */

// Auto-discover HTML entry points from root
const htmlFiles = fs
  .readdirSync(resolve(__dirname, "."))
  .filter((f) => f.endsWith(".html"))
  .reduce((entries, file) => {
    const name = file.replace(".html", "");
    entries[name === "index" ? "" : name] = resolve(__dirname, file);
    return entries;
  }, {});

// Page-specific JS modules for modular architecture
// These are processed by Vite and can be referenced in HTML pages
const pageModules = {
  home: resolve(__dirname, "src/js/pages/home.js"),
  veterans: resolve(__dirname, "src/js/pages/veterans.js"),
  battles: resolve(__dirname, "src/js/pages/battles.js"),
  technology: resolve(__dirname, "src/js/pages/technology.js"),
  articles: resolve(__dirname, "src/js/pages/articles.js"),
  letters: resolve(__dirname, "src/js/pages/letters.js"),
  political: resolve(__dirname, "src/js/pages/political.js"),
};

export default defineConfig({
  // Root is the project root (contains index.html)
  root: ".",

  // Base path for production - root-relative
  base: "/",

  // Resolve configuration
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@css": resolve(__dirname, "src/css"),
      "@js": resolve(__dirname, "src/js"),
      "@components": resolve(__dirname, "src/js/components"),
      "@utils": resolve(__dirname, "src/js/utils"),
      "@core": resolve(__dirname, "src/js/core"),
      "@pages": resolve(__dirname, "src/js/pages"),
      "@templates": resolve(__dirname, "src/templates"),
      "@data": resolve(__dirname, "data"),
      "@public": resolve(__dirname, "public"),
    },
  },

  // Build configuration
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,

    // Optimize for multi-page archive
    rollupOptions: {
      input: {
        ...htmlFiles,
        ...pageModules,
      },
      output: {
        // Preserve clean URLs for SEO
        entryFileNames: "assets/js/[name]-[hash].js",
        chunkFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split(".");
          const ext = info[info.length - 1];
          if (/\.(css)$/.test(assetInfo.name)) {
            return "assets/css/[name]-[hash].css";
          }
          if (/\.(png|jpe?g|gif|svg|webp|ico)$/.test(assetInfo.name)) {
            return "assets/images/[name]-[hash].[ext]";
          }
          if (/\.(woff2?|ttf|eot|otf)$/.test(assetInfo.name)) {
            return "assets/fonts/[name]-[hash].[ext]";
          }
          return "assets/[name]-[hash].[ext]";
        },
      },
    },
  },

  // Development server
  server: {
    port: 3000,
    open: true,
    // Preserve original URL paths
    proxy: {
      // Proxy legacy data files for backward compatibility
      "/data/": {
        target: "http://localhost:3000",
        bypass: (req) => {
          // Paths remain as-is
          return null;
        },
      },
    },
  },

  // Static assets from public/
  publicDir: "public",

  // CSS preprocessing
  css: {
    devSourcemap: true,
  },
});
