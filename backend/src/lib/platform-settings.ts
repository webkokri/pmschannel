import { prisma } from '../db';

/** Platform-wide (not tenant-scoped) key/value settings — signup toggles, maintenance
 *  banner, the default commission rate, the Accelerator bundle/price, etc. Backed by the
 *  `PlatformSetting` table; see `modules/admin/platform.ts` for the super-admin CRUD. */
export async function getPlatformSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

export async function setPlatformSetting(key: string, value: unknown): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}
