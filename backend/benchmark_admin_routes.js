const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log("Seeding database...");

    // Clear existing
    await prisma.team.deleteMany();
    await prisma.user.deleteMany();

    const usersToCreate = [];
    const teamsToCreate = [];
    const numRecords = 500;

    for (let i = 0; i < numRecords; i++) {
        usersToCreate.push({
            name: `User ${i}`,
            email: `user${i}_${Date.now()}@test.com`,
            password: "password123",
            storageUsed: 0n,
        });
        teamsToCreate.push({
            name: `Team ${i}`,
            storageUsed: 0n,
            ownerId: 1 // Doesn't matter if it fails fk constraint? Wait, team needs ownerId.
        });
    }

    // Since we need ownerId, create 1 user first to own teams.
    const owner = await prisma.user.create({
        data: { name: "Owner", email: `owner_${Date.now()}@test.com`, password: "password123" }
    });

    for (let i = 0; i < numRecords; i++) {
        teamsToCreate[i].ownerId = owner.id;
    }

    // Create users one by one or in a loop since createMany might not work
    for (let i = 0; i < numRecords; i++) {
        await prisma.user.create({ data: usersToCreate[i] });
    }
    for (let i = 0; i < numRecords; i++) {
        await prisma.team.create({ data: teamsToCreate[i] });
    }

    const allUsers = await prisma.user.findMany();
    const allTeams = await prisma.team.findMany();

    const userStorage = {};
    const teamStorage = {};

    allUsers.forEach(u => userStorage[u.id] = 100n);
    allTeams.forEach(t => teamStorage[t.id] = 200n);

    console.log("Running baseline update...");
    const startBaseline = Date.now();

    // Baseline code
    for (const [userId, size] of Object.entries(userStorage)) {
        await prisma.user.update({
            where: { id: parseInt(userId) },
            data: { storageUsed: size }
        });
    }

    for (const [teamId, size] of Object.entries(teamStorage)) {
        await prisma.team.update({
            where: { id: parseInt(teamId) },
            data: { storageUsed: size }
        });
    }

    const endBaseline = Date.now();
    console.log(`Baseline time: ${endBaseline - startBaseline}ms`);

    // Reset
    console.log("Resetting for optimized run...");
    await prisma.user.updateMany({ data: { storageUsed: 0 } });
    await prisma.team.updateMany({ data: { storageUsed: 0 } });

    console.log("Running optimized update...");
    const startOptimized = Date.now();

    // Optimized code (raw SQL with CASE statements)
    if (Object.keys(userStorage).length > 0) {
        const userIds = Object.keys(userStorage).map(id => parseInt(id));

        // Chunk into max 999 params. Wait, we are doing unsafe string concat so it doesn't matter for limits.
        const BATCH_SIZE = 500;
        const userEntries = Object.entries(userStorage);
        for (let i = 0; i < userEntries.length; i += BATCH_SIZE) {
            const batch = userEntries.slice(i, i + BATCH_SIZE);
            const batchIds = batch.map(([id]) => parseInt(id));
            let userCaseQuery = `UPDATE User SET storageUsed = CASE id `;
            for (const [userId, size] of batch) {
                userCaseQuery += `WHEN ${parseInt(userId)} THEN ${size} `;
            }
            userCaseQuery += `END WHERE id IN (${batchIds.join(',')})`;

            await prisma.$executeRawUnsafe(userCaseQuery);
        }
    }

    if (Object.keys(teamStorage).length > 0) {
        const BATCH_SIZE = 500;
        const teamEntries = Object.entries(teamStorage);
        for (let i = 0; i < teamEntries.length; i += BATCH_SIZE) {
            const batch = teamEntries.slice(i, i + BATCH_SIZE);
            const batchIds = batch.map(([id]) => parseInt(id));
            let teamCaseQuery = `UPDATE Team SET storageUsed = CASE id `;
            for (const [teamId, size] of batch) {
                teamCaseQuery += `WHEN ${parseInt(teamId)} THEN ${size} `;
            }
            teamCaseQuery += `END WHERE id IN (${batchIds.join(',')})`;

            await prisma.$executeRawUnsafe(teamCaseQuery);
        }
    }

    const endOptimized = Date.now();
    console.log(`Optimized Raw time: ${endOptimized - startOptimized}ms`);

    console.log("Resetting for Prisma transaction optimized run...");
    await prisma.user.updateMany({ data: { storageUsed: 0 } });
    await prisma.team.updateMany({ data: { storageUsed: 0 } });

    console.log("Running Prisma Transaction optimized update...");
    const startTxOptimized = Date.now();

    // Batch processing to avoid limit issues
    const BATCH_SIZE = 100; // Define a batch size

    const userEntries = Object.entries(userStorage);
    for (let i = 0; i < userEntries.length; i += BATCH_SIZE) {
        const batch = userEntries.slice(i, i + BATCH_SIZE);
        const updates = batch.map(([userId, size]) =>
            prisma.user.update({
                where: { id: parseInt(userId) },
                data: { storageUsed: size }
            })
        );
        await prisma.$transaction(updates);
    }

    const teamEntries = Object.entries(teamStorage);
    for (let i = 0; i < teamEntries.length; i += BATCH_SIZE) {
        const batch = teamEntries.slice(i, i + BATCH_SIZE);
        const updates = batch.map(([teamId, size]) =>
            prisma.team.update({
                where: { id: parseInt(teamId) },
                data: { storageUsed: size }
            })
        );
        await prisma.$transaction(updates);
    }

    const endTxOptimized = Date.now();
    console.log(`Tx Optimized time: ${endTxOptimized - startTxOptimized}ms`);

    // Reset database to initial state
    await prisma.team.deleteMany();
    await prisma.user.deleteMany();
}

run()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
