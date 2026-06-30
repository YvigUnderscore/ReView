import { prisma } from './prisma';

/**
 * Réglages studio configurables (table Setting). Valeurs par défaut si absentes.
 * Les clés sont aussi modifiables via PUT /api/studio/settings (admin).
 */
export const SETTING_KEYS = {
  MAX_FILE_SIZE: 'max_file_size', // octets
  STORAGE_LIMIT_USER: 'storage_limit_user', // octets (défaut si user.storageLimit null)
  MAX_CONCURRENT_UPLOADS: 'max_concurrent_uploads',
  TRASH_RETENTION_DAYS: 'trash_retention_days', // purge auto après N jours (0 = désactivée)
  DEFAULT_START_FRAME: 'default_start_frame', // frame de départ par défaut des nouveaux projets
} as const;

const DEFAULTS: Record<string, number> = {
  [SETTING_KEYS.MAX_FILE_SIZE]: 5 * 1024 * 1024 * 1024, // 5 Go
  [SETTING_KEYS.STORAGE_LIMIT_USER]: 10 * 1024 * 1024 * 1024, // 10 Go
  [SETTING_KEYS.MAX_CONCURRENT_UPLOADS]: 5,
  [SETTING_KEYS.TRASH_RETENTION_DAYS]: 30,
  [SETTING_KEYS.DEFAULT_START_FRAME]: 1001,
};

export async function getNumericSetting(key: string): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) {
    const n = Number(row.value);
    if (Number.isFinite(n)) return n;
  }
  return DEFAULTS[key] ?? 0;
}
