import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createDb(d1: D1Database = env.DB) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;

export { schema };
