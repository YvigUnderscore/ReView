// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { t } from '../../i18n';
import type { DocsSection } from '../../pages/docs/docsManifest';
import { adminSections } from '../../pages/admin/adminSections';
import { SECTION_KEYWORDS } from '../../pages/admin/settingsSearch';
import { SURFACE_LIMITS, searchDocSurfaces, searchSettingsSurfaces } from './surfaceSearch';

/**
 * The two families of the global search that are not baseline rows.
 *
 * The symptom observed in use comes down to one word: **"watermark" rendered nothing**. The setting exists (in the Diffusion
 * section), the documentation devotes three chapters to it, and the palette stayed silent, because neither is a database record.
 *
 * Segregation is checked here as it is for the server families: at the source, before the list is built. `/admin/*` is refused
 * to every role other than ADMIN; offering these screens to an artist would promise them a closed door.
 */

const page = (path: string, title: string, summary = '', headings: string[] = []) => ({
  path,
  title,
  summary,
  updated: '2026-08-23',
  headings,
});

const MANIFEST: DocsSection[] = [
  {
    dir: 'admin-guide',
    label: 'Admin Guide',
    pages: [
      page(
        'admin-guide/secure-distribution.md',
        'Secure distribution',
        'Everything that leaves the studio: the logo, the burn-ins and slates.',
        ['Four defences', 'Studio logo', 'Viewer watermark', 'Hardened share links'],
      ),
      page('admin-guide/storage.md', 'Storage', 'Buckets, derived files and quarantine.', ['Quotas']),
    ],
  },
  {
    dir: 'user-guide',
    label: 'User Guide',
    pages: [
      page('user-guide/sharing.md', 'Sharing with clients', 'One link, and what it bounds.', [
        'Video source, watermark, downloads',
      ]),
    ],
  },
];

describe('documentation page search', () => {
  it('finds a page by its title', () => {
    const hits = searchDocSurfaces(MANIFEST, 'secure distribution', t);
    expect(hits.map((h) => h.label)).toEqual(['Secure distribution']);
  });

  it('finds a page by its content: "watermark" is in neither its title nor its subtitle', () => {
    const hits = searchDocSurfaces(MANIFEST, 'watermark', t);
    expect(hits.map((h) => h.label)).toEqual(['Secure distribution', 'Sharing with clients']);
  });

  it('says why the page matches: the section, then the chapter found', () => {
    const [hit] = searchDocSurfaces(MANIFEST, 'watermark', t);
    expect(hit.hint).toBe(`${t('docs.sectionAdminGuide')} · Viewer watermark`);
  });

  it('opens the page on its manifest path', () => {
    const [hit] = searchDocSurfaces(MANIFEST, 'quarantine', t);
    expect(hit.to).toBe('/docs?p=admin-guide%2Fstorage.md');
  });

  it('places the title before the chapter: what carries the word goes ahead of what merely mentions it', () => {
    const hits = searchDocSurfaces(MANIFEST, 'storage', t);
    expect(hits[0].label).toBe('Storage');
  });

  it('ignores case and accents, on both sides', () => {
    // The reader types in their language, the documentation is in English: "DÉFENCES" must match "defences" the way
    // "heros" matches "héros".
    for (const typed of ['DEFENCES', 'DÉFENCES', 'defences']) {
      expect(
        searchDocSurfaces(MANIFEST, typed, t).map((h) => h.label),
        typed,
      ).toEqual(['Secure distribution']);
    }
  });

  it('requires all the words: "watermark quarantine" does not return both pages', () => {
    expect(searchDocSurfaces(MANIFEST, 'watermark quarantine', t)).toEqual([]);
    expect(searchDocSurfaces(MANIFEST, 'watermark logo', t).map((h) => h.label)).toEqual([
      'Secure distribution',
    ]);
  });

  it('stays findable by title on a manifest without chapters (earlier build)', () => {
    const old: DocsSection[] = [
      {
        dir: 'api',
        label: 'Api',
        pages: [{ ...page('api/overview.md', 'API overview'), headings: undefined }],
      },
    ];
    expect(searchDocSurfaces(old, 'overview', t)).toHaveLength(1);
    expect(searchDocSurfaces(old, 'watermark', t)).toEqual([]);
  });

  it('caps the number of pages offered', () => {
    const many: DocsSection[] = [
      {
        dir: 'user-guide',
        label: 'User Guide',
        pages: Array.from({ length: 9 }, (_, i) => page(`user-guide/p${i}.md`, `Review ${i}`)),
      },
    ];
    expect(searchDocSurfaces(many, 'review', t)).toHaveLength(SURFACE_LIMITS.docs);
  });

  it('renders nothing on an empty input: the palette is not a table of contents', () => {
    expect(searchDocSurfaces(MANIFEST, '   ', t)).toEqual([]);
  });
});

describe('settings screens search', () => {
  it('"watermark" renders the screen where it is set: the starting symptom', () => {
    const hits = searchSettingsSurfaces('watermark', 'ADMIN', t);
    expect(hits).toHaveLength(1);
    expect(hits[0].to).toBe('/admin/distribution');
    expect(hits[0].label).toBe(t('review.delivery'));
    expect(hits[0].hint).toBe(t('admin.group.reviewContexts'));
  });

  it('also finds by the French word, and by a field label', () => {
    expect(searchSettingsSurfaces('filigrane', 'ADMIN', t).map((h) => h.to)).toEqual(['/admin/distribution']);
    // "Uploads simultanés" is a field, not a section name, and it now leads to the screen that renders it, "Storage",
    // rather than to the catch-all section.
    expect(searchSettingsSurfaces(t('settings.maxUploads'), 'ADMIN', t).map((h) => h.to)).toEqual([
      '/admin/storage',
    ]);
  });

  it('places the screen carrying the word before the one that has it as a synonym', () => {
    // "Corbeille" is also the subject of a Retention setting (the delay before purge); the Corbeille screen is named
    // that way, and it is the one searched for first.
    const hits = searchSettingsSurfaces(t('admin.tab.trash'), 'ADMIN', t);
    expect(hits.map((h) => h.to)).toContain('/admin/retention');
    expect(hits[0].to).toBe('/admin/trash');
  });

  it('offers no administration screen to other roles: it would be refused to them', () => {
    for (const role of ['SUPERVISOR', 'ARTIST', 'CLIENT'] as const) {
      expect(searchSettingsSurfaces('watermark', role, t), role).toEqual([]);
    }
    expect(searchSettingsSurfaces('watermark', undefined, t)).toEqual([]);
  });

  it('caps the number of screens offered', () => {
    expect(searchSettingsSurfaces('a', 'ADMIN', t).length).toBeLessThanOrEqual(SURFACE_LIMITS.settings);
    expect(searchSettingsSurfaces('a', 'ADMIN', t)).toHaveLength(SURFACE_LIMITS.settings);
  });

  it('renders nothing on an empty input, nor on an absent word', () => {
    expect(searchSettingsSurfaces('  ', 'ADMIN', t)).toEqual([]);
    expect(searchSettingsSurfaces('zzzz', 'ADMIN', t)).toEqual([]);
  });

  it('caps each family, without exception', () => {
    for (const limit of Object.values(SURFACE_LIMITS)) expect(limit).toBeGreaterThan(0);
  });

  /**
   * A section added to the sidebar without a keyword could only be searched by its translated title, that is, by the
   * word nobody uses. The two tables live side by side in `pages/admin/`: this test is what holds them together.
   */
  it('covers each settings screen with keywords people actually use', () => {
    for (const section of adminSections(t)) {
      expect(Object.keys(SECTION_KEYWORDS), section.key).toContain(section.key);
    }
  });
});
