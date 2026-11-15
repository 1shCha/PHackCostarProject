import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@duckdb/node-api"],
  // The room labels are read from data/spatial at runtime (not imported), so tell Vercel to ship them.
  outputFileTracingIncludes: {
    "/": ["./data/spatial/*.json"],
    "/api/search": ["./data/spatial/*.json"],
  },
};

export default nextConfig;
