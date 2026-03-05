import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_URL || "http://localhost:3003";

  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("/react/") || id.includes("react-dom") || id.includes("react-router")) return "vendor-react";
              if (id.includes("@radix-ui") || id.includes("lucide-react") || id.includes("sonner")) return "vendor-ui";
              if (id.includes("@supabase") || id.includes("@tanstack/react-query")) return "vendor-data";
              if (id.includes("@stripe") || id.includes("stripe")) return "vendor-stripe";
              // NOTE: forcing recharts/date-fns into a separate chunk caused a TDZ/circular init error in prod.
            }
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
