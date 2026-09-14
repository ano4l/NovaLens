/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "sharp"],
  agentRules: false,
  // Keep generated output away from OneDrive's special handling of `.next`.
  // The environment override remains available for isolated CI verification.
  distDir: process.env.NOVALENS_NEXT_DIST_DIR || ".next-novalens",
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
