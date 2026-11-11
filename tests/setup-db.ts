import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Runs before each test file is imported, so `@/lib/db` connects to a private copy.
const dir = path.resolve(__dirname, ".tmp");
const file = path.join(dir, `test-${randomUUID()}.db`);
fs.copyFileSync(path.join(dir, "template.db"), file);
process.env.DATABASE_URL = `file:${file}`;
