// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type KeyboardEvent, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useProjectContext } from '../../stores/useProjectContext';
import type { Membership } from '../../types/api';
import {
  activeMentionQuery,
  filterCandidates,
  insertMention,
  toCandidates,
  type MentionCandidate,
} from './mentions';

/**
 * @user mention autocomplete (32.B) for a comment textarea.
 * The current project comes from the context (resolved by the review breadcrumb);
 * members share the `qk.project` cache of the Project page.
 */
export function useMentions(
  value: string,
  setValue: (v: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
) {
  const projectId = useProjectContext((s) => s.projectId);
  const projQ = useQuery({
    queryKey: qk.project(projectId ?? 0),
    queryFn: () => api.get<{ project: { memberships: Membership[] } }>(`/api/projects/${projectId}`),
    enabled: projectId != null,
    staleTime: 60_000,
  });
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const candidates: MentionCandidate[] = mention
    ? filterCandidates(toCandidates(projQ.data?.project.memberships ?? []), mention.query)
    : [];
  const open = mention !== null && candidates.length > 0;

  /** Call after each keystroke or click: detects the mention under the caret. */
  const refresh = () => {
    const el = textareaRef.current;
    const next = el ? activeMentionQuery(el.value, el.selectionStart ?? el.value.length) : null;
    setMention(next);
    if (next?.query !== mention?.query) setActiveIndex(0);
  };

  const pick = (c: MentionCandidate) => {
    const el = textareaRef.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? value.length;
    const out = insertMention(value, caret, mention.start, c.handle);
    setValue(out.text);
    setMention(null);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(out.caret, out.caret);
    }, 0);
  };

  /** Intercepts menu navigation; returns true if the event is consumed. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => (i + d + candidates.length) % candidates.length);
      return true;
    }
    if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
      e.preventDefault();
      pick(candidates[activeIndex] ?? candidates[0]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMention(null);
      return true;
    }
    return false;
  };

  return { open, candidates, activeIndex, refresh, pick, onKeyDown };
}

export type Mentions = ReturnType<typeof useMentions>;
