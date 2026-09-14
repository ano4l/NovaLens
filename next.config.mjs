/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "sharp"],
  agentRules: false,
  // Vercel's Next.js adapter requires its conventional `.next` output path.
  // Locally, keep generated output away from OneDrive's handling of `.next`.
  distDir: process.env.VERCEL
    ? ".next"
    : process.env.NOVALENS_NEXT_DIST_DIR || ".next-novalens",
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
