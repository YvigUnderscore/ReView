// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AtSign, Bell, ClipboardCheck, ListTodo, MessageSquare, Radio, Reply, Stamp } from 'lucide-react';
import type { Notification } from '../../types/api';

/**
 * Icon of a notification, by its type.
 *
 * The comparison is done in capitals: a review decision used to be written `review_decision`, and therefore fell back on the
 * generic bell, like an unknown type. Here, unlike the click destination, tolerating the old spelling costs nothing: an icon
 * cannot open the wrong media.
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
