import { PrismaClient, Role, AssetType, TaskType, MediaKind, VersionStatus, MediaStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed de développement : 1 studio, 1 admin, 1 artiste, 1 projet avec séquence/shot/task/version,
 * 1 asset réutilisable. Idempotent via upserts sur les clés uniques.
 */
async function main(): Promise<void> {
  const studio = await prisma.studio.upsert({
    where: { slug: 'review-studio' },
    update: {},
    create: { name: 'ReView Studio', slug: 'review-studio' },
  });

  const adminPassword = await bcrypt.hash('admin1234', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@review.local' },
    update: {},
    create: { email: 'admin@review.local', password: adminPassword, name: 'Admin', role: Role.ADMIN },
  });

  const artistPassword = await bcrypt.hash('artist1234', 12);
  const artist = await prisma.user.upsert({
    where: { email: 'artist@review.local' },
    update: {},
    create: { email: 'artist@review.local', password: artistPassword, name: 'Artiste', role: Role.ARTIST },
  });

  const project = await prisma.project.upsert({
    where: { studioId_slug: { studioId: studio.id, slug: 'demo-project' } },
    update: {},
    create: {
      studioId: studio.id,
      name: 'Demo Project',
      slug: 'demo-project',
      description: 'Projet de démonstration (seed).',
      memberships: { create: [{ userId: admin.id }, { userId: artist.id }] },
    },
  });

  const sequence = await prisma.sequence.upsert({
    where: { projectId_code: { projectId: project.id, code: 'SQ010' } },
    update: {},
    create: { projectId: project.id, name: 'Ouverture', code: 'SQ010', order: 0 },
  });

  const shot = await prisma.shot.upsert({
    where: {
      projectId_sequenceId_code: { projectId: project.id, sequenceId: sequence.id, code: 'SH010' },
    },
    update: {},
    create: { projectId: project.id, sequenceId: sequence.id, name: 'Plan large', code: 'SH010', startFrame: 1001, endFrame: 1120 },
  });

  // Task sur le shot + version + média (placeholder, sans fichier réel dans MinIO)
  const existingTask = await prisma.task.findFirst({ where: { shotId: shot.id, name: 'Animation plan large' } });
  const task =
    existingTask ??
    (await prisma.task.create({
      data: { shotId: shot.id, name: 'Animation plan large', type: TaskType.ANIMATION, assigneeId: artist.id },
    }));

  const existingVersion = await prisma.version.findFirst({ where: { taskId: task.id, name: 'V01' } });
  const version =
    existingVersion ??
    (await prisma.version.create({
      data: { taskId: task.id, name: 'V01', status: VersionStatus.REVIEW, authorId: artist.id },
    }));

  const existingMedia = await prisma.mediaObject.findFirst({ where: { versionId: version.id } });
  if (!existingMedia) {
    await prisma.mediaObject.create({
      data: {
        versionId: version.id,
        kind: MediaKind.VIDEO,
        originalName: 'demo.mp4',
        storageKey: `projects/${project.id}/versions/${version.id}/placeholder/demo.mp4`,
        mimeType: 'video/mp4',
        status: MediaStatus.READY,
        uploaderId: artist.id,
        metadata: { frameRate: 24 },
      },
    });
  }

  // Asset réutilisable
  await prisma.asset.upsert({
    where: { projectId_name: { projectId: project.id, name: 'Héros' } },
    update: {},
    create: { projectId: project.id, name: 'Héros', type: AssetType.CHARACTER, description: 'Personnage principal' },
  });

  console.info('✅ Seed terminé.');
  console.info('   Admin  : admin@review.local / admin1234');
  console.info('   Artiste: artist@review.local / artist1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
