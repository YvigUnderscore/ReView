// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolRail from './ToolRail';
import { toolsFor, viewActionsFor, type RailSection } from './tools';
import { splatEditRail } from '../splat/splatChrome';
import { t } from '../../../i18n';

/**
 * The multi-group rail (Phase 50, batch 13). What is verified: a tool in a second group is
 * **directly clickable** — that is the request — and it arms the mode + tool pair of its group,
 * hence exactly what its key letter arms on the keyboard.
 */
const MAIN: RailSection = { mode: 'explore', titleKey: 'rail.tools', tools: toolsFor('explore', 'SPLAT') };
const EDIT = splatEditRail(true)!;

function mount(opts: { sections?: RailSection[]; mode?: RailSection['mode']; tool?: string } = {}) {
  const onTool = vi.fn();
  render(
    <ToolRail
      sections={opts.sections ?? [MAIN, EDIT]}
      actions={viewActionsFor('SPLAT')}
      mode={opts.mode ?? 'explore'}
      tool={(opts.tool ?? 'nav') as never}
      onTool={onTool}
      onAction={vi.fn()}
      labels
      onLabels={vi.fn()}
    />,
  );
  return { onTool };
}

describe('ToolRail — groups', () => {
  it('shows the editing tools without any mode being armed', () => {
    mount();
    for (const tool of EDIT.tools)
      expect(screen.getByRole('button', { name: t(tool.labelKey) })).toBeInTheDocument();
  });

  it('arms the mode + tool pair of the clicked group', () => {
    const { onTool } = mount();
    fireEvent.click(screen.getByRole('button', { name: t('tool.selLasso') }));
    expect(onTool).toHaveBeenCalledWith('sel-lasso', 'clean');
    fireEvent.click(screen.getByRole('button', { name: t('tool.poi') }));
    expect(onTool).toHaveBeenCalledWith('pin', 'explore');
  });

  it('lights a tool only in the group that arms it', () => {
    // `translate` only exists in "Clean up": when armed, it is the second group's button that
    // lights up, and the first group stays idle — that is how one gets out of the mode.
    mount({ mode: 'clean', tool: 'translate' });
    expect(screen.getByRole('button', { name: t('tool.translate') })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: t('tool.nav') })).toHaveAttribute('aria-pressed', 'false');
  });

  it('titles each group and keeps the two view actions at the foot', () => {
    mount();
    expect(screen.getByText(t('rail.tools'))).toBeInTheDocument();
    expect(screen.getByText(t(EDIT.titleKey))).toBeInTheDocument();
    for (const action of viewActionsFor('SPLAT'))
      expect(screen.getByRole('button', { name: t(action.labelKey) })).toBeInTheDocument();
  });

  it('shrinks to a single group when the viewer provides only one', () => {
    mount({ sections: [MAIN] });
    expect(screen.queryByRole('button', { name: t('tool.selRect') })).not.toBeInTheDocument();
  });
});

/**
 * Batch 15 — rail height contract, the same trap as `.rv-row`: an EXPLICIT `min-height` replaces
 * the flex's automatic minimum size, thereby reopening the compression that the latter forbade.
 * The rail is a column bounded by the viewer's height, and since the splat puts a second group on
 * it, it carries about fifteen entries: without a refusal to compress, the buttons get squashed
 * below their height and their content overflows — and with no scrollbar, nothing catches it.
 *
 * The rail's classes live in a stylesheet that vitest does not load, and happy-dom lays nothing
 * out: the stylesheet is therefore read as text. It is a proof of structure, not of rendering.
 */
const CHROME_CSS = readFileSync(resolve(process.cwd(), 'src/v2/pages/review/chrome/chrome.css'), 'utf8');
const COMMENT = /\/\*[\s\S]*?\*\//g;

/** Body of a rule, exact selector: `.rv-rail` does not match `.rv-rail--labels` nor `.rv-rail__title`. */
function ruleOf(selector: string): string {
  const start = CHROME_CSS.indexOf(`\n${selector} {`);
  expect(start, `règle ${selector} introuvable dans chrome.css`).toBeGreaterThan(-1);
  const open = CHROME_CSS.indexOf('{', start);
  // COMMENTS are removed: the one on `.rv-railbtn` cites the declaration we are looking for, and
  // the assertion would then pass even if the declaration had vanished.
  return CHROME_CSS.slice(open, CHROME_CSS.indexOf('}', open)).replace(COMMENT, '');
}

describe('rail — height contract', () => {
  it('refuses to compress its buttons below their height', () => {
    const rule = ruleOf('.rv-railbtn');
    // The pair matters: it is the explicit `min-height` that undoes the automatic protection.
    expect(rule).toContain('min-height: 2.25rem');
    expect(rule).toContain('flex-shrink: 0');
  });

  it('scrolls when it carries more entries than the viewer height', () => {
    expect(ruleOf('.rv-rail')).toContain('overflow-y: auto');
    expect(ruleOf('.rv-dock__tabs')).toContain('overflow-y: auto');
  });
});
