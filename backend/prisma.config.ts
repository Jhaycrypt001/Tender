import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env itself. Load it if present; real environments
// set variables directly.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://tender:tender@localhost:5434/tender",
  },
});
