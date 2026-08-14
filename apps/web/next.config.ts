import type { NextConfig } from "next";

const r2PublicHostname = process.env.R2_PUBLIC_URL_BASE
  ? new URL(process.env.R2_PUBLIC_URL_BASE).hostname
  : "pub-ceb14a129f364e8d8d4f74b4f0dd014b.r2.dev";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: r2PublicHostname,
      },
    ],
  },
};

export default nextConfig;
