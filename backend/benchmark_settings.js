const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runBenchmark() {
    console.log('Generating test data...');
    const updates = {};
    for (let i = 0; i < 100; i++) {
        updates[`setting_${i}`] = `value_${i}_${Date.now()}`;
    }

    console.log('Starting baseline measurement...');
    const start = process.hrtime.bigint();

    // The existing inefficient code
    for (const [key, value] of Object.entries(updates)) {
        await prisma.systemSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) }
        });
    }

    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    console.log(`Baseline time: ${durationMs.toFixed(2)} ms`);

    // Test the optimized code
    console.log('Generating test data for optimized run...');
    const optimizedUpdates = {};
    for (let i = 0; i < 100; i++) {
        optimizedUpdates[`setting_${i}`] = `optimized_value_${i}_${Date.now()}`;
    }

    console.log('Starting optimized measurement...');
    const startOpt = process.hrtime.bigint();

    const transactions = Object.entries(optimizedUpdates).map(([key, value]) => {
        return prisma.systemSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) }
        });
    });
    await prisma.$transaction(transactions);

    const endOpt = process.hrtime.bigint();
    const durationOptMs = Number(endOpt - startOpt) / 1e6;
    console.log(`Optimized time: ${durationOptMs.toFixed(2)} ms`);

    console.log(`Improvement: ${((durationMs - durationOptMs) / durationMs * 100).toFixed(2)}%`);

    await prisma.$disconnect();
}

runBenchmark().catch(console.error);
