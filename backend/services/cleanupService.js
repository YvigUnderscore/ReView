const { PrismaClient } = require('@prisma/client');
const { updateStorage } = require('../utils/storage');
const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

const prisma = new PrismaClient();
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '../storage');

async function runCleanup() {
    try {
        const retentionSetting = await prisma.systemSetting.findUnique({ where: { key: 'trash_retention_days' } });
        const retentionDays = retentionSetting ? parseInt(retentionSetting.value) : 7;

        if (retentionDays < 0) return; // Disabled?

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Fetch all expired projects (only need IDs and basic info)
        const expiredProjects = await prisma.project.findMany({
            where: {
                deletedAt: {
                    lt: cutoffDate
                }
            },
            select: { id: true, teamId: true }
        });

        console.log(`[Cleanup] Found ${expiredProjects.length} expired projects (older than ${retentionDays} days).`);

        const CHUNK_SIZE = 50;
        for (let i = 0; i < expiredProjects.length; i += CHUNK_SIZE) {
            const batch = expiredProjects.slice(i, i + CHUNK_SIZE);
            const projectIds = batch.map(p => p.id);

            console.log(`[Cleanup] Processing batch ${Math.floor(i / CHUNK_SIZE) + 1} (${batch.length} projects)...`);

            try {
                // 1. Fetch all related data for the batch
                const [videos, assets, bundles] = await Promise.all([
                    prisma.video.findMany({ where: { projectId: { in: projectIds } } }),
                    prisma.threeDAsset.findMany({ where: { projectId: { in: projectIds } } }),
                    prisma.imageBundle.findMany({ where: { projectId: { in: projectIds } }, include: { images: true } })
                ]);

                // Collect IDs for comment fetching
                const videoIds = videos.map(v => v.id);
                const assetIds = assets.map(a => a.id);
                const imageIds = bundles.flatMap(b => b.images.map(img => img.id));

                const comments = await prisma.comment.findMany({
                    where: {
                        OR: [
                            { videoId: { in: videoIds } },
                            { threeDAssetId: { in: assetIds } },
                            { imageId: { in: imageIds } }
                        ]
                    }
                });

                // 2. Aggregate Data
                const filesToDelete = [];
                const teamStorageUpdates = new Map(); // teamId -> delta (BigInt)
                const userStorageUpdates = new Map(); // userId -> delta (BigInt)

                // Helper to add to map
                const addToMap = (map, key, value) => {
                    if (!key) return;
                    const current = map.get(key) || 0n;
                    map.set(key, current + BigInt(value));
                };

                // Process Videos
                for (const v of videos) {
                    if (v.path) filesToDelete.push(v.path);
                    // Find project for teamId
                    const project = batch.find(p => p.id === v.projectId);
                    if (project && project.teamId) {
                        addToMap(teamStorageUpdates, project.teamId, -BigInt(v.size));
                    }
                }

                // Process Assets
                for (const a of assets) {
                    if (a.path) filesToDelete.push(a.path);
                    const project = batch.find(p => p.id === a.projectId);
                    if (project && project.teamId) {
                        addToMap(teamStorageUpdates, project.teamId, -BigInt(a.size));
                    }
                }

                // Process Bundles (Images)
                for (const b of bundles) {
                    const project = batch.find(p => p.id === b.projectId);
                    for (const img of b.images) {
                        if (img.path) filesToDelete.push(img.path);
                        if (project && project.teamId) {
                            addToMap(teamStorageUpdates, project.teamId, -BigInt(img.size));
                        }
                    }
                }

                // Process Comments
                for (const c of comments) {
                    // Attachments
                    if (c.attachmentPaths) {
                        try {
                            const paths = JSON.parse(c.attachmentPaths);
                            for (const attachPath of paths) {
                                filesToDelete.push(path.join(DATA_PATH, 'media', attachPath));
                            }
                        } catch (e) {}
                    }
                    // Screenshot
                    if (c.screenshotPath) {
                        filesToDelete.push(path.join(DATA_PATH, 'comments', c.screenshotPath));
                    }

                    // User Storage
                    if (c.userId && c.size > 0) {
                        addToMap(userStorageUpdates, c.userId, -BigInt(c.size));
                    }
                }

                // 3. Delete Files
                // Use Promise.all
                await Promise.all(filesToDelete.map(async (p) => {
                    try {
                        await fsp.unlink(p);
                    } catch (e) {
                        // Ignore ENOENT (file not found)
                        if (e.code !== 'ENOENT') {
                           // Log error but don't stop
                           // console.error(`[Cleanup] Failed to delete file ${p}:`, e.message);
                        }
                    }
                }));

                // 4. Update Storage
                for (const [teamId, delta] of teamStorageUpdates) {
                    if (delta !== 0n) {
                         // Convert BigInt back to Number for updateStorage utility which expects Number usually,
                         // but let's check if it handles BigInt. It does: const delta = BigInt(deltaBytes);
                         // However, passing BigInt to a function expecting Number might fail if it's not handled.
                         // updateStorage receives { deltaBytes }.
                         // const delta = BigInt(deltaBytes); will work if deltaBytes is BigInt too.
                         // But usually JS functions might expect Number.
                         // Let's safe cast to Number if it's within range, or keep BigInt if updateStorage handles it.
                         // storage.js: `if (!deltaBytes || deltaBytes === 0) return; const delta = BigInt(deltaBytes);`
                         // BigInt(BigInt) works. So passing BigInt is fine.
                         await updateStorage({ teamId, deltaBytes: delta });
                    }
                }
                for (const [userId, delta] of userStorageUpdates) {
                    if (delta !== 0n) {
                        await updateStorage({ userId, teamId: null, deltaBytes: delta });
                    }
                }

                // 5. Delete Projects
                await prisma.project.deleteMany({
                    where: { id: { in: projectIds } }
                });

                console.log(`[Cleanup] Batch complete. Deleted ${projectIds.length} projects.`);

            } catch (err) {
                console.error(`[Cleanup] Error processing batch:`, err);
            }
        }

    } catch (e) {
        console.error('[Cleanup] Error running cleanup:', e);
    }
}

module.exports = { runCleanup };
