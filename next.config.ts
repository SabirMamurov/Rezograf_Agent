import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["192.168.242.206", "192.168.242.112"],
};

export default nextConfig;
