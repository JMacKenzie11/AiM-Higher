import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // prompts/*.md is read at runtime via fs.readFile in the transcript
  // analyzer. Next.js file tracing can't see that dependency, so on
  // Vercel the file is missing from /var/task and analysis fails with
  // ENOENT. Force it into every serverless bundle.
  outputFileTracingIncludes: {
    // Both directories are read at runtime via fs.readFile — Next.js
    // file tracing can't see the dependency, so on Vercel they're
    // missing from /var/task and the reads ENOENT. Force them into
    // every serverless bundle.
    "*": ["./prompts/**/*", "./docs/help/**/*"],
  },
};

export default nextConfig;
