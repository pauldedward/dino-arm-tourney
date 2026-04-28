/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // sharp + @react-pdf are heavy native deps; keep them server-only
  serverExternalPackages: ["sharp", "@react-pdf/renderer"],
  turbopack: {},
};
export default nextConfig;
