// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadWidget, { UploadRow } from './UploadWidget';
import { useUploadStore, type UploadItem } from '../../stores/useUploadStore';
import { useSequenceUploadStore } from '../../stores/useSequenceUploadStore';
import { t } from '../i18n';

/**
 * The most-viewed widget of the day returned five hard-coded French labels from a
 * function, invisible to the i18n detector, which only reads JSX text. These cases fix
 * the two things that count: not one word outside the catalog, and a way out for
 * each line (cancel a transfer, remove a finished line).
 */

const item = (over: Partial<UploadItem>): UploadItem => ({
  id: 'u1',
  filename: 'sh010_v003.mov',
  versionId: 1,
  kind: 'VIDEO',
  progress: 40,
  status: 'uploading',
  ...over,
});

const row = (over: Partial<UploadItem>): string =>
  renderToStaticMarkup(<UploadRow item={item(over)} onDismiss={() => {}} />);

/**
 * happy-dom opens a 1024 px window. The fallback threshold was lowered to 560 px, so the
 * default now shows the full variant. We still set the width
 * explicitly: a test that talks about the fallback must say which width it is talking about.
 */
const setViewportWidth = (width: number): void => {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number }) => void } }).happyDOM.setViewport({
    width,
  });
};

/**
 * The accessible name of the badge: it carries the x/y and, when a send is in flight,
 * the current state. Batch 14 made it speak: the former name ("Transfers (2)")
 * said neither how many had arrived nor what was going on.
 */
const triggerName = (done: number, total: number, status?: string): string =>
  status === undefined
    ? t('uploads.summaryAria', { done, total })
    : t('uploads.summaryBusyAria', { done, total, status });

/** Both queues are module singletons: a test must leave nothing for the next one. */
beforeEach(() => {
  useUploadStore.setState({ uploads: [] });
  useSequenceUploadStore.setState({ uploads: [], proposal: null });
  setViewportWidth(1600);
});

describe('UploadWidget', () => {
  it('renders nothing when no transfer is in progress', () => {
    expect(renderToStaticMarkup(<UploadWidget />)).toBe('');
  });

  /**
   * Batch 13 moved the panel out of the bottom-right corner, where it sat on top of the pagination of
   * lists, the viewer HUD and the anchored conversation. This case locks in the counterpart:
   * the widget no longer positions itself, it is just an element of the header row.
   */
  it('no longer floats in a corner: nothing is positioned there outside the flow', () => {
    useUploadStore.setState({ uploads: [item({})] });
    const { container } = render(<UploadWidget />);
    const classes = [...container.querySelectorAll('*')].flatMap((el) => [...el.classList]);
    expect(classes).not.toContain('fixed');
    expect(classes).not.toContain('absolute');
    expect(classes.filter((c) => /^(bottom|right|left|top|z)-/.test(c))).toEqual([]);
  });

  it('comes down to an unfoldable badge, the detail remaining behind a click', async () => {
    useUploadStore.setState({
      uploads: [item({}), item({ id: 'u2', filename: 'sh020_v001.mov' })],
    });
    render(<UploadWidget />);
    // Collapsed: the account and the state, but no file name takes up the row.
    const trigger = screen.getByRole('button', {
      name: triggerName(0, 2, t('uploads.sending', { pct: 40 })),
    });
    expect(trigger).toHaveTextContent('0/2');
    expect(screen.queryByText('sh010_v003.mov')).toBeNull();
    await userEvent.click(trigger);
    expect(await screen.findByText('sh010_v003.mov')).toBeInTheDocument();
    expect(screen.getByText('sh020_v001.mov')).toBeInTheDocument();
  });

  it('shows the overall progress without unfolding it: a send is tracked', () => {
    useUploadStore.setState({ uploads: [item({ progress: 30 }), item({ id: 'u2', progress: 50 })] });
    const { container } = render(<UploadWidget />);
    const bars = [...container.querySelectorAll('span')].map((el) => el.style.width);
    expect(bars).toContain('40%');
  });

  /**
   * The fallback used to kick in below 1100 px, the shell's "narrow window" threshold. A misreading,
   * acknowledged and corrected: that is the width where the row gains the most room (search
   * falls to an icon), and "seeing the status text during an upload" is precisely aimed at
   * the laptop and the shared window. This case replaces the one that froze the former behaviour.
   */
  it('keeps the status text well below 1100 px: laptop, shared window', () => {
    setViewportWidth(900);
    useUploadStore.setState({ uploads: [item({ progress: 30 })] });
    const { container } = render(<UploadWidget />);
    expect(screen.getByText(t('uploads.sending', { pct: 30 }))).toBeInTheDocument();
    expect([...container.querySelectorAll('span')].map((el) => el.style.width)).toContain('30%');
  });

  it('keeps only the count at phone width, where the breadcrumb has no room left', () => {
    setViewportWidth(420);
    useUploadStore.setState({ uploads: [item({ progress: 30 })] });
    const { container } = render(<UploadWidget />);
    expect([...container.querySelectorAll('span')].map((el) => el.style.width)).not.toContain('30%');
    expect(screen.queryByText(t('uploads.sending', { pct: 30 }))).toBeNull();
    // The x/y, for its part, remains: it is what says that a send is in progress and how far along it is.
    const trigger = screen.getByRole('button', {
      name: triggerName(0, 1, t('uploads.sending', { pct: 30 })),
    });
    expect(trigger).toHaveTextContent('0/1');
  });

  /**
   * The other half of the constraint: the visible text must not push the breadcrumb out of
   * the row. The badge lives in the flow (batch 13) and does not shrink, so it is the text
   * that must be bounded and truncated, whatever the length of the translation.
   */
  it('bounds the status text: it truncates rather than pushing the breadcrumb out of the row', () => {
    setViewportWidth(900);
    useUploadStore.setState({ uploads: [item({ progress: 30 })] });
    render(<UploadWidget />);
    const classes = [...screen.getByText(t('uploads.sending', { pct: 30 })).classList];
    expect(classes).toContain('truncate');
    expect(classes.some((c) => /^max-w-\[/.test(c))).toBe(true);
  });

  /**
   * "x/y": what has arrived out of what was requested. A failed line is not a completion:
   * it stays in the denominator until it is removed, otherwise a "3/3" badge would announce
   * a complete send while a shot is missing.
   */
  it('counts finished lines out of the total, a failure not being a completion', () => {
    useUploadStore.setState({
      uploads: [
        item({ id: 'a', status: 'done', progress: 100 }),
        item({ id: 'b', status: 'error', progress: 60, error: 'PUT 403' }),
        item({ id: 'c', status: 'uploading', progress: 20 }),
      ],
    });
    render(<UploadWidget />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('shows the current status text without unfolding it', () => {
    useUploadStore.setState({ uploads: [item({ status: 'uploading', progress: 42 })] });
    const { rerender } = render(<UploadWidget />);
    expect(screen.getByText(t('uploads.sending', { pct: 42 }))).toBeInTheDocument();
    // And it follows the phase, not just the byte: the transcoding can be read too.
    useUploadStore.setState({ uploads: [item({ status: 'processing', kind: 'VIDEO' })] });
    rerender(<UploadWidget />);
    expect(screen.getByText(t('uploads.transcoding'))).toBeInTheDocument();
  });

  /**
   * Three transfers go up at once, the others wait: the *majority* state of a
   * drop of thirty shots would remain "Waiting" from start to finish. The badge therefore shows
   * the most advanced line, the one whose state will change next.
   */
  it('picks the most advanced line when several are in flight', () => {
    useUploadStore.setState({
      uploads: [
        item({ id: 'a', status: 'pending', progress: 0 }),
        item({ id: 'b', status: 'uploading', progress: 70 }),
        item({ id: 'c', status: 'pending', progress: 0 }),
      ],
    });
    render(<UploadWidget />);
    expect(screen.getByText(t('uploads.sending', { pct: 70 }))).toBeInTheDocument();
    expect(screen.queryByText(t('uploads.pending'))).toBeNull();
  });

  it('shows no status at rest: everything has arrived, there is nothing left to tell', () => {
    useUploadStore.setState({ uploads: [item({ status: 'done', progress: 100 })] });
    render(<UploadWidget />);
    expect(screen.getByRole('button', { name: triggerName(1, 1) })).toBeInTheDocument();
    expect(screen.queryByText(t('project.status.completed'))).toBeNull();
    expect(screen.queryByText(t('uploads.sending', { pct: 100 }))).toBeNull();
  });

  /**
   * "Make this panel more visible when it is active": at rest it is one icon among
   * the bar's others; in flight it is a framed surface, the same as the bell's preview.
   */
  it('stands out from a bar icon when a send is in flight', () => {
    useUploadStore.setState({ uploads: [item({ status: 'uploading', progress: 10 })] });
    const { rerender } = render(<UploadWidget />);
    const classesOf = (name: string): string[] => [...screen.getByRole('button', { name }).classList];
    const busy = classesOf(triggerName(0, 1, t('uploads.sending', { pct: 10 })));
    expect(busy).toContain('border');
    expect(busy).toContain('bg-secondary/40');
    expect(busy).not.toContain('text-muted-foreground');

    useUploadStore.setState({ uploads: [item({ status: 'done', progress: 100 })] });
    rerender(<UploadWidget />);
    const idle = classesOf(triggerName(1, 1));
    expect(idle).not.toContain('border');
    expect(idle).toContain('text-muted-foreground');
  });

  it('leaves no trace when the last line is removed', () => {
    useUploadStore.setState({ uploads: [item({})] });
    const { container, rerender } = render(<UploadWidget />);
    useUploadStore.setState({ uploads: [] });
    rerender(<UploadWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The location IS the requested fix: a widget that no longer positions itself
 * must be mounted where one wants to see it, otherwise it ends up at the end of the tree without anything
 * saying so. No suite mounts the whole shell (it pulls in messaging, the palette, real time and
 * six requests): so we check the composition at the source, on the sole
 * file that decides the location.
 */
describe('Placement in the shell', () => {
  const shell = readFileSync('src/v2/components/Shell.tsx', 'utf8');
  const header = /<header[\s\S]*?<\/header>/.exec(shell)?.[0] ?? '';

  it('mounts the send tracker in the header row, and nowhere else', () => {
    expect(header).toContain('<UploadWidget />');
    expect(shell.split('<UploadWidget />')).toHaveLength(2);
  });

  it('places it to the left of the search, like the bell', () => {
    expect(header.indexOf('<UploadWidget />')).toBeLessThan(header.indexOf('<NotificationBell />'));
    expect(header.indexOf('<NotificationBell />')).toBeLessThan(header.indexOf("t('shell.search')"));
  });
});

describe('UploadRow', () => {
  it('no longer leaves a single hard-coded label, whatever the state', () => {
    const html = [
      row({ status: 'pending' }),
      row({ status: 'uploading' }),
      row({ status: 'finalizing' }),
      row({ status: 'processing', kind: 'VIDEO' }),
      row({ status: 'processing', kind: 'MODEL_3D' }),
      row({ status: 'processing', kind: 'IMAGE' }),
      row({ status: 'done' }),
      row({ status: 'error', error: 'boom' }),
    ].join('');
    for (const leak of [
      'En attente',
      'Validation…',
      'Transcodage',
      'Conversion 3D',
      'Traitement…',
      'Échec',
    ]) {
      expect(html).not.toContain(leak);
    }
  });

  it('distinguishes processing states by media type', () => {
    const video = row({ status: 'processing', kind: 'VIDEO' });
    const model = row({ status: 'processing', kind: 'MODEL_3D' });
    const image = row({ status: 'processing', kind: 'IMAGE' });
    expect(video).not.toBe(model);
    expect(model).not.toBe(image);
  });

  it('offers "cancel" on a live transfer and "remove" on a finished line', () => {
    // The labels come from the base English catalog, the only one embedded at startup.
    expect(row({ status: 'uploading' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'pending' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'finalizing' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'done' })).toContain('aria-label="Remove"');
    expect(row({ status: 'error', error: 'boom' })).toContain('aria-label="Remove"');
  });

  it('shows the file name, its progress and the failure reason', () => {
    const html = row({ status: 'error', progress: 60, error: 'PUT 403' });
    expect(html).toContain('sh010_v003.mov');
    expect(html).toContain('PUT 403');
    expect(html).toContain('60%');
  });

  it('replaces the bar with an indeterminate wait during server processing', () => {
    expect(row({ status: 'processing', progress: 100 })).toContain('animate-pulse');
    expect(row({ status: 'uploading', progress: 100 })).not.toContain('animate-pulse');
  });
});
