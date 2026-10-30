#!/usr/bin/env node
// Grants the admin role to an existing user.
// Usage:
//   npm run admin:grant -- someone@example.com            (local dev DB)
//   npm run admin:grant -- someone@example.com --remote   (production DB)
import { execFileSync } from "node:child_process";

const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
const remote = process.argv.includes("--remote");

if (!email || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
  console.error("Usage: npm run admin:grant -- <email> [--remote]");
  process.exit(1);
}

const sql = `UPDATE user SET role = 'admin' WHERE email = '${email.toLowerCase()}'; SELECT id, name, role FROM user WHERE email = '${email.toLowerCase()}';`;
const args = ["wrangler", "d1", "execute", "DB", "--command", sql];
if (remote) args.push("--remote", "--env", "production");
else args.push("--local");

execFileSync("npx", args, { stdio: "inherit" });
console.log("Done.");
