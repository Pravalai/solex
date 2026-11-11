import type { NextConfig } from "next";

// Cache Components is deliberately off: every screen in this demo renders
// request-time, permission-scoped data, so the previous (dynamic) model is simpler.
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
