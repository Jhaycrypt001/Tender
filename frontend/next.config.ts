import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There is a stray package.json in the home directory above this project.
  // Without pinning the root, Next walks up and adopts C:\Users\USER as the
  // workspace, which breaks module resolution.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
