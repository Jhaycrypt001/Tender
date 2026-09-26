import { execSync } from "node:child_process";

/**
 * Integration tests run against their own database, `tender_test`, on the
 * docker-compose Postgres — never the dev database. `migrate deploy` creates
 * it on first run and applies any new migrations after that.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://tender:tender@localhost:5434/tender_test";

export default function setup() {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
