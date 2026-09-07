/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp", "@google/genai"],
};

export default nextConfig;
