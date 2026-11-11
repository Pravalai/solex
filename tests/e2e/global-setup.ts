import { execSync } from "node:child_process";

/** Every E2E run starts from the same deterministic demo data. */
export default function globalSetup() {
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}
