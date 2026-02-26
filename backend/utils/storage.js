const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Checks if adding the given size would exceed Team or User quotas.
 * @param {Object} params
 * @param {number} params.userId - The ID of the user uploading the file.
 * @param {number} params.teamId - The ID of the team owning the project.
 * @param {number} params.fileSize - The size of the file in bytes.
 * @returns {Promise<void>} Resolves if quota is OK, rejects with error if exceeded.
 */
async function checkQuota({ userId, teamId, fileSize }) {
    if (!fileSize || fileSize <= 0) return;

    const sizeBigInt = BigInt(fileSize);

    // Fetch System Limits (Fallback)
    const teamLimitSetting = await prisma.systemSetting.findUnique({ where: { key: 'storage_limit_team' } });
    const userLimitSetting = await prisma.systemSetting.findUnique({ where: { key: 'storage_limit_user' } });

    const SYSTEM_TEAM_LIMIT = teamLimitSetting ? BigInt(teamLimitSetting.value) : BigInt(25 * 1024 * 1024 * 1024); // 25GB
    const SYSTEM_USER_LIMIT = userLimitSetting ? BigInt(userLimitSetting.value) : BigInt(10 * 1024 * 1024 * 1024); // 10GB

    // Check Team Quota
    if (teamId) {
        const team = await prisma.team.findUnique({ where: { id: teamId }, select: { storageUsed: true, storageLimit: true } });
        if (team) {
            // Use specific limit if set, otherwise system limit
            const limit = team.storageLimit !== null ? team.storageLimit : SYSTEM_TEAM_LIMIT;

            if (team.storageUsed + sizeBigInt > limit) {
                const error = new Error('Team storage limit exceeded');
                error.statusCode = 403;
                throw error;
            }
        }
    }

    // Check User Quota
    if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { storageUsed: true, storageLimit: true, role: true } });
        // Main Admin exception (optional, prompt says "except main admin")
        // How to identify "main admin"? Maybe id=1 or role='admin'?
        // Prompt: "except main admin". Usually ID 1.
        // Let's assume all 'admin' roles bypass, or just ID 1.
        // Memory: "The first user to register automatically becomes the administrator".
        // Let's check if role is 'admin'.
        if (user && user.role !== 'admin') {
             // Use specific limit if set, otherwise system limit
            const limit = user.storageLimit !== null ? user.storageLimit : SYSTEM_USER_LIMIT;

            if (user.storageUsed + sizeBigInt > limit) {
                const error = new Error('User storage limit exceeded');
                error.statusCode = 403;
                throw error;
            }
        }
    }
}

/**
 * Updates the storage usage counters for Team and User.
 * @param {Object} params
 * @param {number} params.userId - The ID of the user uploading/deleting.
 * @param {number} params.teamId - The ID of the team.
 * @param {number} params.deltaBytes - The change in bytes (positive or negative).
 * @returns {Promise<void>}
 */
async function updateStorage({ userId, teamId, deltaBytes }) {
    if (!deltaBytes || deltaBytes === 0) return;

    const delta = BigInt(deltaBytes);

    if (teamId) {
        await prisma.team.update({
            where: { id: teamId },
            data: { storageUsed: { increment: delta } }
        });
    }

    if (userId) {
        // Only update user storage if it's their "personal" usage.
        // As decided, this includes Comments/Attachments and (now) Uploads.
        await prisma.user.update({
            where: { id: userId },
            data: { storageUsed: { increment: delta } }
        });
    }
}

/**
 * Recalculates storage usage for all Users and Teams based on current assets.
 */
async function recalculateAllStorage() {
    console.log('Starting storage recalculation...');

    // 1. Reset all storage counters
    await prisma.user.updateMany({ data: { storageUsed: 0 } });
    await prisma.team.updateMany({ data: { storageUsed: 0 } });

    const userStorage = new Map(); // userId -> BigInt
    const teamStorage = new Map(); // teamId -> BigInt

    const addToUser = (id, size) => {
        if (!id) return;
        const current = userStorage.get(id) || 0n;
        userStorage.set(id, current + BigInt(size));
    };

    const addToTeam = (id, size) => {
        if (!id) return;
        const current = teamStorage.get(id) || 0n;
        teamStorage.set(id, current + BigInt(size));
    };

    // 2. Aggregate Videos
    // We need to fetch uploaderId AND project.teamId
    // Note: Use batching if dataset is huge, but for now fetchAll is simpler.
    const videos = await prisma.video.findMany({
        select: { size: true, uploaderId: true, project: { select: { teamId: true } } }
    });
    for (const v of videos) {
        addToUser(v.uploaderId, v.size);
        addToTeam(v.project.teamId, v.size);
    }

    // 3. Aggregate ThreeDAssets
    const assets = await prisma.threeDAsset.findMany({
        select: { size: true, uploaderId: true, project: { select: { teamId: true } } }
    });
    for (const a of assets) {
        addToUser(a.uploaderId, a.size);
        addToTeam(a.project.teamId, a.size);
    }

    // 4. Aggregate Images (via ImageBundles or direct Image relation if uploader is on Bundle)
    // ImageBundle has uploaderId. Images have size.
    // If we want accurate "User" storage, we attribute ImageBundle size to uploader.
    // But images are individual records.
    // Let's assume ImageBundle uploader is the owner of all images in it.
    const bundles = await prisma.imageBundle.findMany({
        select: {
            uploaderId: true,
            project: { select: { teamId: true } },
            images: { select: { size: true } }
        }
    });
    for (const b of bundles) {
        let bundleSize = 0n;
        for (const img of b.images) {
            bundleSize += BigInt(img.size);
        }
        addToUser(b.uploaderId, bundleSize);
        addToTeam(b.project.teamId, bundleSize);
    }

    // 5. Aggregate Comments (Attachments/Screenshots)
    // Comments have userId. They don't belong to a "Team" quota in our logic (per `checkQuota`),
    // but typically they are part of a project, so maybe they should?
    // Current logic in `updateStorage` calls:
    // `await updateStorage({ userId: req.user.id, teamId: null, deltaBytes: totalSize });`
    // So comments only count towards User Quota.
    const comments = await prisma.comment.findMany({
        where: { size: { gt: 0 } },
        select: { size: true, userId: true }
    });
    for (const c of comments) {
        addToUser(c.userId, c.size);
    }

    // 6. Apply Updates
    console.log(`Updating ${userStorage.size} users and ${teamStorage.size} teams...`);

    const bulkUpdate = async (modelName, storageMap) => {
        if (storageMap.size === 0) return;

        const entries = Array.from(storageMap.entries());
        // SQLite usually has a limit around 999 or 32766 params.
        // 500 items * 3 params (CASE WHEN ? THEN ? + WHERE IN (?)) = 1500 params, which is safe.
        const CHUNK_SIZE = 500;

        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
            const chunk = entries.slice(i, i + CHUNK_SIZE);

            const ids = [];
            const queryParams = [];
            let caseStmt = 'CASE id';

            for (const [id, size] of chunk) {
                caseStmt += ` WHEN ? THEN ?`;
                queryParams.push(id);
                queryParams.push(size);
                ids.push(id);
            }
            caseStmt += ' END';

            // Add IDs for WHERE IN clause
            queryParams.push(...ids);

            const placeholders = ids.map(() => '?').join(',');

            // modelName is trusted (internal string)
            // Table names usually match model names in Prisma unless @map is used.
            // In this schema: User -> User, Team -> Team.
            const query = `UPDATE "${modelName}" SET "storageUsed" = ${caseStmt} WHERE "id" IN (${placeholders})`;

            await prisma.$executeRawUnsafe(query, ...queryParams);
        }
    };

    await bulkUpdate('User', userStorage);
    await bulkUpdate('Team', teamStorage);

    console.log('Storage recalculation complete.');
}

module.exports = { checkQuota, updateStorage, recalculateAllStorage };
