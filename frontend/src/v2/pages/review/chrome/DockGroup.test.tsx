// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Group, Row } from './DockGroup';
import { DOCK_GROUP_COLLAPSE_THRESHOLD, isLongDockGroup } from './dockGroupSize';
import { t } from '../../../i18n';

/**
 * Collapsing of dock groups (Phase 50, batch 6). None of them used to collapse: the Info panel of
 * a rich USD scene had to be scrolled, and a short group — the four measures of the current
 * frame — fell out of view.
 *
 * What is verified: the threshold, the automatic collapse beyond it, the fact that a collapsed
 * group hides its content while keeping its count, and that the header action (save a view, arm
 * the measure) stays reachable in both states — it does not live in the collapse trigger.
 *
 * Added on top (batch 15) is the row height contract, which can be read neither in the DOM nor in
 * TypeScript: the dock classes live in a stylesheet that vitest does not load, and happy-dom
 * lays nothing out. The stylesheet is therefore read as text — it is a proof of structure, not
 * of rendering.
 */

// Vitest runs from `frontend/` (see vitest.config.ts), as for the theme tokens.
const CHROME_CSS = readFileSync(resolve(process.cwd(), 'src/v2/pages/review/chrome/chrome.css'), 'utf8');

/** Body of a rule, exact selector: `.rv-row` does not match `.rv-row--stack`. */
function ruleOf(selector: string): string {
  // The selector is searched at the start of a line: otherwise `.rv-row` would match `.rv-row__label`.
  const start = CHROME_CSS.indexOf(`\n${selector} {`);
  expect(start, `règle ${selector} introuvable dans chrome.css`).toBeGreaterThan(-1);
  const open = CHROME_CSS.indexOf('{', start);
  return CHROME_CSS.slice(open, CHROME_CSS.indexOf('}', open));
}

describe('isLongDockGroup', () => {
  it('only counts as long beyond the threshold', () => {
    expect(isLongDockGroup(DOCK_GROUP_COLLAPSE_THRESHOLD)).toBe(false);
    expect(isLongDockGroup(DOCK_GROUP_COLLAPSE_THRESHOLD + 1)).toBe(true);
    expect(isLongDockGroup(0)).toBe(false);
  });
});

describe('Group', () => {
  it('remains a simple title when it is not collapsible', () => {
    render(<Group title="Technical sheet">contenu</Group>);
    expect(screen.getByText('contenu')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('collapses and expands on a click on its title', () => {
    render(
      <Group title="Textures" collapsible>
        contenu
      </Group>,
    );
    const toggle = screen.getByRole('button', { name: /Textures/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('contenu')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('title', t('review.dock.group.expand'));

    fireEvent.click(toggle);
    expect(screen.getByText('contenu')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('title', t('review.dock.group.collapse'));
  });

  it('starts collapsed when asked, keeping its count visible', () => {
    render(
      <Group title="Textures" collapsible defaultCollapsed count={12}>
        contenu
      </Group>,
    );
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
    // The count is what tells whether the closed group is worth a click.
    expect(screen.getByRole('button', { name: /12/ })).toBeInTheDocument();
  });

  it('collapses nothing without `collapsible`, even with `defaultCollapsed`', () => {
    // The automatic collapse is a consequence of collapsing, not a way to hide a group.
    render(
      <Group title="Live render" defaultCollapsed>
        contenu
      </Group>,
    );
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('keeps the header action clickable, group collapsed or expanded', () => {
    render(
      <Group title="Measurements" collapsible defaultCollapsed action={<button>Ruler</button>}>
        contenu
      </Group>,
    );
    expect(screen.getByRole('button', { name: 'Ruler' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Measurements/ }));
    expect(screen.getByRole('button', { name: 'Ruler' })).toBeInTheDocument();
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });
});

describe('Row', () => {
  it('carries the classes that hold its height, and its index as a tooltip', () => {
    render(
      <Row label="Purpose" hint="/World/Chair" stack>
        <input aria-label="ctl" />
      </Row>,
    );
    const row = screen.getByText('Purpose').parentElement;
    // It is through these classes that the stylesheet contract applies to what is rendered.
    expect(row?.className.split(' ')).toContain('rv-row');
    expect(row?.className.split(' ')).toContain('rv-row--stack');
    expect(row).toHaveAttribute('title', '/World/Chair');
  });

  it('refuses to be compressed below its natural height', () => {
    const rule = ruleOf('.rv-row');
    // The EXPLICIT minimum height replaces the flex's automatic minimum size: without
    // `flex-shrink: 0`, a row placed in a bounded column (`max-h-*` +
    // `overflow-y-auto`, see the USD recomposition) falls back to this step, its stacked content
    // paints over the neighbouring row, and the column has nothing left to scroll.
    expect(rule).toContain('min-height: 1.75rem');
    expect(rule).toContain('flex-shrink: 0');
  });
});
