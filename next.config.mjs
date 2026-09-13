/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "sharp"],
  agentRules: false,
  // Allows CI/OneDrive workspaces to build away from a stale synced .next directory.
  distDir: process.env.NOVALENS_NEXT_DIST_DIR || ".next",
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
