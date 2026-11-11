import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Builds an empty, migrated template database once; each test file gets its own copy. */
export default function setup() {
  const dir = path.resolve(__dirname, ".tmp");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execSync("npx prisma db push", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: "file:./tests/.tmp/template.db" },
    stdio: "pipe",
  });
}
