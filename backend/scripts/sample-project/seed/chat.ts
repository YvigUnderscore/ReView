// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PrismaClient } from '@prisma/client';
import { CHAT_MESSAGES } from '../data/feedback';
import type { SeededStudio } from './studio';

/**
 * Messagerie interne : trois fils d'équipe et un tête-à-tête.
 *
 * Ce sont les conversations qu'un studio a réellement — la séquence en cours, le daily du
 * matin, le canal pipeline — écrites dans le désordre où elles arrivent, avec des messages
 * qui répondent à ce qui se passe ailleurs dans les données (le rig v013, la note sur
 * l'horizon, le déplacement du daily).
 */

const GROUPS: Record<string, { title: string; members: string[] }> = {
  sq010: { title: 'SQ010 — Snow Duel', members: ['tomas', 'sofia', 'marisol', 'malik', 'kenji', 'hannah'] },
  dailies: { title: 'Dailies', members: ['ines', 'tomas', 'marisol', 'elodie', 'kenji', 'sofia', 'malik'] },
  pipeline: { title: 'Pipeline', members: ['ada', 'noah', 'priya', 'elodie', 'rui', 'malik'] },
};

export async function seedChat(prisma: PrismaClient, studio: SeededStudio): Promise<number> {
  let messages = 0;

  for (const [key, group] of Object.entries(GROUPS)) {
    const existing = await prisma.conversation.findFirst({ where: { title: group.title, isGroup: true } });
    const conversation =
      existing ??
      (await prisma.conversation.create({
        data: {
          isGroup: true,
          title: group.title,
          createdById: studio.users.get(group.members[0]!)?.id ?? null,
        },
      }));

    for (const memberKey of group.members) {
      const user = studio.users.get(memberKey);
      if (!user) continue;
      await prisma.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: conversation.id, userId: user.id } },
        update: {},
        create: { conversationId: conversation.id, userId: user.id },
      });
    }

    const lines = CHAT_MESSAGES.filter((m) => m.channel === key);
    for (const line of lines) {
      const author = studio.users.get(line.by);
      if (!author) continue;
      const createdAt = new Date(Date.now() - line.minutesAgo * 60000);
      const already = await prisma.chatMessage.findFirst({
        where: { conversationId: conversation.id, body: line.text },
      });
      if (already) continue;
      await prisma.chatMessage.create({
        data: { conversationId: conversation.id, authorId: author.id, body: line.text, createdAt },
      });
      messages += 1;
    }
    const last = lines.at(-1);
    if (last) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(Date.now() - last.minutesAgo * 60000) },
      });
    }
  }

  // Un tête-à-tête : la conversation qui double le fil de review, comme dans la vraie vie.
  const marisol = studio.users.get('marisol');
  const sofia = studio.users.get('sofia');
  if (marisol && sofia) {
    const existing = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        members: { every: { userId: { in: [marisol.id, sofia.id] } } },
        AND: [{ members: { some: { userId: marisol.id } } }, { members: { some: { userId: sofia.id } } }],
      },
    });
    const direct =
      existing ??
      (await prisma.conversation.create({
        data: {
          isGroup: false,
          createdById: marisol.id,
          members: { create: [{ userId: marisol.id }, { userId: sofia.id }] },
        },
      }));
    const exchange: { by: number; text: string; minutesAgo: number }[] = [
      { by: marisol.id, text: 'Did you get a chance to look at the lantern key on SH0140?', minutesAgo: 220 },
      {
        by: sofia.id,
        text: 'Rendering both options now. The cold rim is much stronger, but it costs the eye light.',
        minutesAgo: 180,
      },
      {
        by: marisol.id,
        text: 'Then keep the eye light and cheat the rim. Tomas will not let that one go.',
        minutesAgo: 150,
      },
      { by: sofia.id, text: 'Agreed. v006 will have both — I will post them side by side.', minutesAgo: 120 },
    ];
    for (const message of exchange) {
      const already = await prisma.chatMessage.findFirst({
        where: { conversationId: direct.id, body: message.text },
      });
      if (already) continue;
      await prisma.chatMessage.create({
        data: {
          conversationId: direct.id,
          authorId: message.by,
          body: message.text,
          createdAt: new Date(Date.now() - message.minutesAgo * 60000),
        },
      });
      messages += 1;
    }
    await prisma.conversation.update({
      where: { id: direct.id },
      data: { lastMessageAt: new Date(Date.now() - 120 * 60000) },
    });
  }

  return messages;
}
