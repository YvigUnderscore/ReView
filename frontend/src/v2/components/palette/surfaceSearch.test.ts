// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { t } from '../../i18n';
import type { DocsSection } from '../../pages/docs/docsManifest';
import { adminSections } from '../../pages/admin/adminSections';
import { SECTION_KEYWORDS } from '../../pages/admin/settingsSearch';
import { SURFACE_LIMITS, searchDocSurfaces, searchSettingsSurfaces } from './surfaceSearch';

/**
 * Les deux familles de la recherche globale qui ne sont pas des lignes de base.
 *
 * Le symptôme relevé à l'usage tient en un mot : **« watermark » ne rendait rien**. Le
 * réglage existe (Diffusion), la documentation lui consacre trois chapitres, et la palette
 * restait muette — parce qu'aucune des deux n'est un enregistrement en base.
 *
 * Le cloisonnement est vérifié ici comme celui des familles serveur : à la source, avant que
 * la liste ne soit constituée. `/admin/*` est refusé à tout autre rôle qu'ADMIN ; proposer
 * ces écrans à un artiste serait lui promettre une porte fermée.
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

describe('recherche de pages de documentation', () => {
  it('trouve une page par son titre', () => {
    const hits = searchDocSurfaces(MANIFEST, 'secure distribution', t);
    expect(hits.map((h) => h.label)).toEqual(['Secure distribution']);
  });

  it('trouve une page par son contenu — « watermark » n’est ni dans son titre ni dans son sous-titre', () => {
    const hits = searchDocSurfaces(MANIFEST, 'watermark', t);
    expect(hits.map((h) => h.label)).toEqual(['Secure distribution', 'Sharing with clients']);
  });

  it('dit pourquoi la page correspond : la section, puis le chapitre trouvé', () => {
    const [hit] = searchDocSurfaces(MANIFEST, 'watermark', t);
    expect(hit.hint).toBe(`${t('docs.sectionAdminGuide')} · Viewer watermark`);
  });

  it('ouvre la page sur son chemin de manifest', () => {
    const [hit] = searchDocSurfaces(MANIFEST, 'quarantine', t);
    expect(hit.to).toBe('/docs?p=admin-guide%2Fstorage.md');
  });

  it('place le titre avant le chapitre : ce qui porte le mot passe devant ce qui le mentionne', () => {
    const hits = searchDocSurfaces(MANIFEST, 'storage', t);
    expect(hits[0].label).toBe('Storage');
  });

  it('ignore la casse et les accents, des deux côtés', () => {
    // Le lecteur tape dans sa langue, la documentation est en anglais : « DÉFENCES » doit
    // rejoindre « defences » comme « heros » rejoint « héros ».
    for (const typed of ['DEFENCES', 'DÉFENCES', 'defences']) {
      expect(
        searchDocSurfaces(MANIFEST, typed, t).map((h) => h.label),
        typed,
      ).toEqual(['Secure distribution']);
    }
  });

  it('exige tous les mots : « watermark quarantine » ne rend pas les deux pages', () => {
    expect(searchDocSurfaces(MANIFEST, 'watermark quarantine', t)).toEqual([]);
    expect(searchDocSurfaces(MANIFEST, 'watermark logo', t).map((h) => h.label)).toEqual([
      'Secure distribution',
    ]);
  });

  it('reste cherchable par titre sur un manifest sans chapitres (build antérieur)', () => {
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

  it('borne le nombre de pages proposées', () => {
    const many: DocsSection[] = [
      {
        dir: 'user-guide',
        label: 'User Guide',
        pages: Array.from({ length: 9 }, (_, i) => page(`user-guide/p${i}.md`, `Review ${i}`)),
      },
    ];
    expect(searchDocSurfaces(many, 'review', t)).toHaveLength(SURFACE_LIMITS.docs);
  });

  it('ne rend rien sur une saisie vide — la palette n’est pas un sommaire', () => {
    expect(searchDocSurfaces(MANIFEST, '   ', t)).toEqual([]);
  });
});

describe('recherche d’écrans de réglages', () => {
  it('« watermark » rend l’écran où on le règle — le symptôme de départ', () => {
    const hits = searchSettingsSurfaces('watermark', 'ADMIN', t);
    expect(hits).toHaveLength(1);
    expect(hits[0].to).toBe('/admin/distribution');
    expect(hits[0].label).toBe(t('review.delivery'));
    expect(hits[0].hint).toBe(t('admin.group.reviewContexts'));
  });

  it('trouve aussi par le mot français, et par un libellé de champ', () => {
    expect(searchSettingsSurfaces('filigrane', 'ADMIN', t).map((h) => h.to)).toEqual(['/admin/distribution']);
    // « Uploads simultanés » est un champ de la section fourre-tout, pas un nom de section.
    expect(searchSettingsSurfaces(t('settings.maxUploads'), 'ADMIN', t).map((h) => h.to)).toContain(
      '/admin/settings',
    );
  });

  it('place l’écran qui porte le mot avant celui qui l’a en synonyme', () => {
    // « Réglages » liste « corbeille » parmi ses mots-clés ; l'écran Corbeille, lui, s'appelle
    // ainsi — c'est celui qu'on cherche.
    const hits = searchSettingsSurfaces(t('admin.tab.trash'), 'ADMIN', t);
    expect(hits.map((h) => h.to)).toContain('/admin/settings');
    expect(hits[0].to).toBe('/admin/trash');
  });

  it('ne propose aucun écran d’administration aux autres rôles — il leur serait refusé', () => {
    for (const role of ['SUPERVISOR', 'ARTIST', 'CLIENT'] as const) {
      expect(searchSettingsSurfaces('watermark', role, t), role).toEqual([]);
    }
    expect(searchSettingsSurfaces('watermark', undefined, t)).toEqual([]);
  });

  it('borne le nombre d’écrans proposés', () => {
    expect(searchSettingsSurfaces('a', 'ADMIN', t).length).toBeLessThanOrEqual(SURFACE_LIMITS.settings);
    expect(searchSettingsSurfaces('a', 'ADMIN', t)).toHaveLength(SURFACE_LIMITS.settings);
  });

  it('ne rend rien sur une saisie vide, ni sur un mot absent', () => {
    expect(searchSettingsSurfaces('  ', 'ADMIN', t)).toEqual([]);
    expect(searchSettingsSurfaces('zzzz', 'ADMIN', t)).toEqual([]);
  });

  it('borne chaque famille, sans exception', () => {
    for (const limit of Object.values(SURFACE_LIMITS)) expect(limit).toBeGreaterThan(0);
  });

  /**
   * Une section ajoutée à la barre latérale sans mot-clé ne se chercherait que par son
   * titre traduit — c'est-à-dire par le mot que personne n'emploie. Les deux tables vivent
   * côte à côte dans `pages/admin/` : ce test est ce qui les tient ensemble.
   */
  it('couvre chaque écran de réglages par des mots-clés d’usage', () => {
    for (const section of adminSections(t)) {
      expect(Object.keys(SECTION_KEYWORDS), section.key).toContain(section.key);
    }
  });
});
