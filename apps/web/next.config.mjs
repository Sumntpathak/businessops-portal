/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { instrumentationHook: true },
  transpilePackages: ["@recepto/shared", "@recepto/calendar"]
};

export default nextConfig;

