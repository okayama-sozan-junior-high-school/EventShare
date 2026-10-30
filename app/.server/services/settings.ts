import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { appSettings } from "../db/schema";
import {
  DEFAULT_DUPLICATE_CONFIG,
  duplicateConfigSchema,
  type DuplicateConfig,
} from "../duplicates/score";

const DUPLICATE_KEY = "duplicate_detection";

export async function getDuplicateConfig(db: Database): Promise<DuplicateConfig> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, DUPLICATE_KEY),
  });
  if (!row) return DEFAULT_DUPLICATE_CONFIG;
  const parsed = duplicateConfigSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_DUPLICATE_CONFIG;
}

export async function saveDuplicateConfig(
  db: Database,
  config: DuplicateConfig,
  userId: string,
) {
  const value = duplicateConfigSchema.parse(config);
  await db
    .insert(appSettings)
    .values({ key: DUPLICATE_KEY, value, updatedById: userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedById: userId, updatedAt: new Date() },
    });
}
