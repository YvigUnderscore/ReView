// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SplatViewerMenus from './SplatViewerMenus';
import { splatEditTools } from './splatChrome';
import { panelsFor } from '../chrome/panels';
import type { SplatCompareState } from './compare/useSplatCompare';
import type { SplatEditorState } from './editor/useSplatEditor';
import { t } from '../../../i18n';

/**
 * The splat's RENDER settings live on the viewer (Phase 50, batch 12), in the same language as the render
 * popover of the 3D model (batch 6): the "Display" tab of the dock disappeared along with them, and it is
 * the editor's state (the very one that applies them to the scene) that carries them.
 *
 * The cases of the "Edit" popover were DELIBERATELY REMOVED in batch 13: this popover no longer exists. It
 * carried the tools of the "Clean up" mode, whereas the user had asked for the SEGMENT to be removed from the
 * header, not for the tools to be filed behind a click. They came back to the rail (`splatChrome.splatEditRail`,
 * verified by `splatChrome.test.ts` and `ToolRail.test.tsx`), and the last case below locks in the absence of the duplicate.
 */

const editorState = (over: Partial<SplatEditorState> = {}) =>
  ({
    renderMode: 'splats',
    setRenderMode: vi.fn(),
    baseFlip: true,
    toggleBaseFlip: vi.fn(),
    ...over,
  }) as unknown as SplatEditorState;

const presState = () => ({ debugMode: 'none' as const, setDebugMode: vi.fn() });

function mount(opts: { showEdit?: boolean; editor?: SplatEditorState; compare?: SplatCompareState } = {}) {
  const editor = opts.editor ?? editorState();
  render(
    <SplatViewerMenus
      editor={editor}
      showEdit={opts.showEdit ?? true}
      pres={presState()}
      compare={opts.compare}
    />,
  );
  return { editor };
}

const openRender = () => fireEvent.click(screen.getByRole('button', { name: t('viewer.render.title') }));

describe('dock du splat', () => {
  it('no longer has a "Display" tab: the render settings are on the viewer', () => {
    // The tab's label was removed from the catalogues along with it: the composition of the dock attests
    // to it, being the sole source of truth for tabs.
    expect(panelsFor('SPLAT').map((p) => p.id)).toEqual(['camera', 'scene', 'info', 'export']);
  });
});

describe('SplatViewerMenus — render menu', () => {
  it('carries the three render modes of the cloud and goes through the editor state', () => {
    const setRenderMode = vi.fn();
    mount({ editor: editorState({ setRenderMode }) });
    openRender();

    const group = screen.getByRole('group', { name: t('viewer.render.cloud') });
    expect(group.querySelectorAll('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: t('viewer.mode.points') }));
    expect(setRenderMode).toHaveBeenCalledWith('points');
  });

  it('keeps the orientation of the file, which is an edit', () => {
    const toggleBaseFlip = vi.fn();
    mount({ editor: editorState({ toggleBaseFlip }) });
    openRender();
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.upAxis.hint') }));
    expect(toggleBaseFlip).toHaveBeenCalled();
  });

  it('offers neither cloud rendering nor orientation without an editor', () => {
    mount({ showEdit: false });
    openRender();
    expect(screen.queryByRole('group', { name: t('viewer.render.cloud') })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: t('viewer.upAxis.hint') })).not.toBeInTheDocument();
    // The inspection tint, for its part, is not recorded: it remains on offer to everyone.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('offers the raw scale as soon as the comparison carries two clouds', () => {
    const toggleNormalized = vi.fn();
    mount({
      compare: { enabled: true, normalized: true, toggleNormalized } as unknown as SplatCompareState,
    });
    openRender();
    fireEvent.click(screen.getByRole('switch', { name: t('viewer.realScale.hint') }));
    expect(toggleNormalized).toHaveBeenCalled();
  });
});

describe('the viewer no longer duplicates the rail', () => {
  it('no longer has an "Edit" menu: its tools are on the rail, one click away', () => {
    mount();
    expect(screen.queryByRole('button', { name: t('viewer.edit.title') })).not.toBeInTheDocument();
    // And none of its tools is reachable here: a single location carries them.
    for (const tool of splatEditTools())
      expect(screen.queryByRole('button', { name: t(tool.labelKey) })).not.toBeInTheDocument();
  });
});
