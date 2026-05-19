const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function seed(numTeams, projectsPerTeam) {
  console.log(`Seeding ${numTeams} teams and ${numTeams * projectsPerTeam} projects...`);

  // Create a user first to be the owner
  const user = await prisma.user.upsert({
    where: { email: 'benchmark@example.com' },
    update: {},
    create: {
      email: 'benchmark@example.com',
      password: 'password',
      name: 'Benchmark User'
    }
  });

  const createdTeams = [];
  for (let i = 0; i < numTeams; i++) {
    const team = await prisma.team.create({
      data: {
        name: `Team ${i}`,
        ownerId: user.id,
        slug: null
      }
    });
    createdTeams.push(team);
  }

  for (const team of createdTeams) {
    for (let j = 0; j < projectsPerTeam; j++) {
      await prisma.project.create({
        data: {
          name: `Project ${j} for Team ${team.id}`,
          teamId: team.id,
          slug: null
        }
      });
    }
  }

  // Add some collisions
  await prisma.team.create({
    data: {
      name: 'Collision Team',
      ownerId: user.id,
      slug: 'collision'
    }
  });
  await prisma.team.create({
    data: {
      name: 'Collision Team',
      ownerId: user.id,
      slug: null // Should become collision-team (slugified name)
    }
  });

  console.log('Seeding complete.');
}

async function clearData() {
  console.log('Clearing benchmark data...');
  // Delete projects first due to FK
  await prisma.project.deleteMany({ where: { name: { contains: 'Project' } } });
  await prisma.team.deleteMany({ where: { OR: [{ name: { contains: 'Team' } }, { name: 'Collision Team' }] } });
  console.log('Data cleared.');
}

async function runBenchmark() {
  const start = Date.now();
  try {
    // Note: This script assumes it's being run from the backend directory
    execSync('node scripts/backfill_slugs.js', { stdio: 'inherit', env: process.env });
  } catch (e) {
    console.error('Backfill failed', e);
  }
  const end = Date.now();
  return end - start;
}

async function main() {
  try {
    // Ensure we are using a test database or at least aware of what we are doing
    console.log('Using DATABASE_URL:', process.env.DATABASE_URL);

    await clearData();
    await seed(200, 5); // 200 teams, 5 projects each = 1000 projects. 1200 total records to backfill.

    console.log('Running benchmark...');
    const duration = await runBenchmark();
    console.log(`Benchmark completed in ${duration}ms`);

    // Verify
    const nullTeams = await prisma.team.count({ where: { slug: null } });
    const nullProjects = await prisma.project.count({ where: { slug: null } });
    console.log('Null teams:', nullTeams);
    console.log('Null projects:', nullProjects);

    const collisionTeam = await prisma.team.findFirst({
        where: {
        name: 'Collision Team',
        slug: 'collision-team'
        }
    });
    console.log('Collision team (slug: collision-team) found:', !!collisionTeam);

    if (nullTeams > 0 || nullProjects > 0 || !collisionTeam) {
        console.error('Verification failed!');
        process.exit(1);
    }
    console.log('Verification successful!');

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
