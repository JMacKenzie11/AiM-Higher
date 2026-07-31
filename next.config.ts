import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // prompts/*.md is read at runtime via fs.readFile in the transcript
  // analyzer. Next.js file tracing can't see that dependency, so on
  // Vercel the file is missing from /var/task and analysis fails with
  // ENOENT. Force it into every serverless bundle.
  outputFileTracingIncludes: {
    "*": ["./prompts/**/*"],
  },
};

export default nextConfig;
