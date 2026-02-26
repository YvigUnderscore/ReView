
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { runCleanup } = require('./services/cleanupService');

const prisma = new PrismaClient();

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'storage');
const TEST_PROJECT_COUNT = 50;

async function seed() {
    console.log('Seeding database for benchmark...');

    // Ensure storage dirs exist
    const mediaDir = path.join(DATA_PATH, 'media');
    const commentsDir = path.join(DATA_PATH, 'comments');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    if (!fs.existsSync(commentsDir)) fs.mkdirSync(commentsDir, { recursive: true });

    // Create a dummy user and team
    const user = await prisma.user.create({
        data: {
            email: `bench_${Date.now()}@example.com`,
            password: 'password',
            name: 'Benchmark User'
        }
    });

    const team = await prisma.team.create({
        data: {
            name: 'Benchmark Team',
            ownerId: user.id
        }
    });

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30); // 30 days ago (assuming retention is 7)

    const projects = [];

    for (let i = 0; i < TEST_PROJECT_COUNT; i++) {
        const project = await prisma.project.create({
            data: {
                name: `Expired Project ${i}`,
                teamId: team.id,
                deletedAt: pastDate
            }
        });
        projects.push(project);

        // Create dummy video file
        const videoPath = path.join(mediaDir, `video_${project.id}.mp4`);
        fs.writeFileSync(videoPath, 'dummy content');
        const video = await prisma.video.create({
            data: {
                projectId: project.id,
                filename: `video_${project.id}.mp4`,
                originalName: 'video.mp4',
                mimeType: 'video/mp4',
                path: videoPath,
                size: 1000,
                uploaderId: user.id
            }
        });

        // Create dummy comment
        await prisma.comment.create({
            data: {
                videoId: video.id,
                userId: user.id,
                content: 'Benchmark comment',
                timestamp: 0,
                size: 500
            }
        });
    }

    console.log(`Seeded ${TEST_PROJECT_COUNT} expired projects.`);
    return { user, team };
}

async function run() {
    await seed();

    console.log('Starting cleanup benchmark...');
    const start = performance.now();

    await runCleanup();

    const end = performance.now();
    console.log(`Cleanup finished in ${(end - start).toFixed(2)}ms`);

    // Verify
    const remaining = await prisma.project.count({
        where: { name: { startsWith: 'Expired Project' } }
    });
    console.log(`Remaining projects: ${remaining}`);

    // Cleanup seed user/team (projects should be gone)
    // We can't easily delete the user/team without cascading if projects remain, but they shouldn't.
    // Ideally we'd delete the user/team we created.
}

run()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
