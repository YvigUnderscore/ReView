// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TimelineOptionsMenu from './TimelineOptionsMenu';

const off = { available: false, enabled: false, onToggle: () => {} };

const openOn = (label: string) => fireEvent.contextMenu(screen.getByTestId(label));

describe('TimelineOptionsMenu', () => {
  it('rien à proposer : la barre est rendue nue, le clic droit remonte au viewer', () => {
    render(
      <TimelineOptionsMenu canAddMarker={false} onAddMarker={() => {}} waveform={off} autoAdvance={off}>
        <div data-testid="bar" />
      </TimelineOptionsMenu>,
    );
    openOn('bar');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('propose le marqueur, la forme d’onde et l’enchaînement quand ils existent', () => {
    render(
      <TimelineOptionsMenu
        canAddMarker
        onAddMarker={() => {}}
        waveform={{ available: true, enabled: true, onToggle: () => {} }}
        autoAdvance={{ available: true, enabled: false, onToggle: () => {} }}
      >
        <div data-testid="bar" />
      </TimelineOptionsMenu>,
    );
    openOn('bar');
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    const toggles = screen.getAllByRole('menuitemcheckbox');
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toHaveAttribute('aria-checked', 'true');
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('cocher une bascule la rapporte', () => {
    const onToggle = vi.fn();
    render(
      <TimelineOptionsMenu
        canAddMarker={false}
        onAddMarker={() => {}}
        waveform={{ available: true, enabled: false, onToggle }}
        autoAdvance={off}
      >
        <div data-testid="bar" />
      </TimelineOptionsMenu>,
    );
    openOn('bar');
    fireEvent.click(screen.getByRole('menuitemcheckbox'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
