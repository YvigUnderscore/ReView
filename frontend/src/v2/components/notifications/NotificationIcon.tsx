// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AtSign, Bell, ClipboardCheck, ListTodo, MessageSquare, Radio, Reply, Stamp } from 'lucide-react';
import type { Notification } from '../../types/api';

/**
 * Pictogramme d'une notification, d'après son type.
 *
 * La comparaison se fait en capitales : une décision de review s'écrivait
 * `review_decision`, et tombait donc sur la cloche générique au même titre qu'un type
 * inconnu. Ici, contrairement à la destination du clic, tolérer l'ancienne graphie ne
 * coûte rien — une icône ne peut pas ouvrir le mauvais média.
 */
export default function NotificationIcon({ type }: { type: Notification['type'] }) {
  const cls = 'mt-0.5 shrink-0 text-muted-foreground';
  switch (type.toUpperCase()) {
    case 'TASK_ASSIGNED':
      return <ListTodo size={16} className={cls} />;
    case 'REPLY':
      return <Reply size={16} className={cls} />;
    case 'COMMENT_ASSIGNED':
      return <MessageSquare size={16} className={cls} />;
    case 'REVIEW_ASSIGNED':
      return <ClipboardCheck size={16} className={cls} />;
    case 'REVIEW_DECISION':
      return <Stamp size={16} className={cls} />;
    case 'MENTION':
      return <AtSign size={16} className={cls} />;
    case 'LIVE':
      return <Radio size={16} className="mt-0.5 shrink-0 text-accent2" />;
    default:
      return <Bell size={16} className={cls} />;
  }
}
