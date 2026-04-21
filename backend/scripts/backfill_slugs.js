const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

async function backfill() {
  console.log('Starting backfill...');

  // 1. Backfill Teams
  const allTeams = await prisma.team.findMany({
    select: { slug: true },
    where: { NOT: { slug: null } }
  });
  const existingTeamSlugs = new Set(allTeams.map(t => t.slug));

  const teamsToBackfill = await prisma.team.findMany({ where: { slug: null } });
  console.log(`Found ${teamsToBackfill.length} teams without slug.`);

  const teamUpdates = [];
  for (const team of teamsToBackfill) {
    let baseSlug = slugify(team.name);
    if (!baseSlug) baseSlug = `team-${team.id}`;
    let slug = baseSlug;
    let counter = 1;

    while (existingTeamSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    existingTeamSlugs.add(slug);
    teamUpdates.push(
      prisma.team.update({
        where: { id: team.id },
        data: { slug }
      })
    );
  }

  if (teamUpdates.length > 0) {
    console.log(`Executing ${teamUpdates.length} team updates...`);
    const chunkSize = 100;
    for (let i = 0; i < teamUpdates.length; i += chunkSize) {
      await prisma.$transaction(teamUpdates.slice(i, i + chunkSize));
    }
  }

  // 2. Backfill Projects
  const allProjects = await prisma.project.findMany({
    select: { slug: true, teamId: true },
    where: { NOT: { slug: null } }
  });

  const existingProjectSlugs = new Map();
  for (const project of allProjects) {
    if (!existingProjectSlugs.has(project.teamId)) {
      existingProjectSlugs.set(project.teamId, new Set());
    }
    existingProjectSlugs.get(project.teamId).add(project.slug);
  }

  const projectsToBackfill = await prisma.project.findMany({ where: { slug: null } });
  console.log(`Found ${projectsToBackfill.length} projects without slug.`);

  const projectUpdates = [];
  for (const project of projectsToBackfill) {
    let baseSlug = slugify(project.name);
    if (!baseSlug) baseSlug = `project-${project.id}`;
    let slug = baseSlug;
    let counter = 1;

    if (!existingProjectSlugs.has(project.teamId)) {
      existingProjectSlugs.set(project.teamId, new Set());
    }
    const teamSlugs = existingProjectSlugs.get(project.teamId);

    while (teamSlugs.has(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    teamSlugs.add(slug);
    projectUpdates.push(
      prisma.project.update({
        where: { id: project.id },
        data: { slug }
      })
    );
  }

  if (projectUpdates.length > 0) {
    console.log(`Executing ${projectUpdates.length} project updates...`);
    const chunkSize = 100;
    for (let i = 0; i < projectUpdates.length; i += chunkSize) {
      await prisma.$transaction(projectUpdates.slice(i, i + chunkSize));
    }
  }

  console.log('Backfill complete.');
}

backfill()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
