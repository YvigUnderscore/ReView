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
 * Le widget le plus vu de la journée renvoyait cinq libellés français en dur depuis une
 * fonction — invisibles du détecteur i18n, qui ne lit que le texte JSX. Ces cas fixent
 * les deux choses qui comptent : plus un mot hors catalogue, et une sortie possible pour
 * chaque ligne (annuler un transfert, retirer une ligne finie).
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
 * happy-dom ouvre une fenêtre de 1024 px. Le seuil de repli est descendu à 560 px, donc le
 * défaut montre désormais la variante complète — on règle quand même la largeur
 * explicitement : un test qui parle de repli doit dire de quelle largeur il parle.
 */
const setViewportWidth = (width: number): void => {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number }) => void } }).happyDOM.setViewport({
    width,
  });
};

/**
 * Le nom accessible de la pastille — c'est lui qui porte le x/y et, quand un envoi est en
 * vol, l'état en cours. Le lot 14 l'a rendu parlant : le nom d'avant (« Transferts (2) »)
 * ne disait ni combien étaient arrivés ni ce qui se passait.
 */
const triggerName = (done: number, total: number, status?: string): string =>
  status === undefined
    ? t('uploads.summaryAria', { done, total })
    : t('uploads.summaryBusyAria', { done, total, status });

/** Les deux files sont des singletons de module : un test ne doit rien laisser au suivant. */
beforeEach(() => {
  useUploadStore.setState({ uploads: [] });
  useSequenceUploadStore.setState({ uploads: [], proposal: null });
  setViewportWidth(1600);
});

describe('UploadWidget', () => {
  it('ne rend rien quand aucun transfert n’est en cours', () => {
    expect(renderToStaticMarkup(<UploadWidget />)).toBe('');
  });

  /**
   * Le lot 13 sort l'encart du coin bas droit, où il se posait par-dessus la pagination des
   * listes, le HUD du viewer et la conversation ancrée. Ce cas verrouille la contrepartie :
   * le widget ne se positionne plus lui-même, il n'est qu'un élément de la rangée d'en-tête.
   */
  it('ne flotte plus dans un coin : rien n’y est positionné hors du flux', () => {
    useUploadStore.setState({ uploads: [item({})] });
    const { container } = render(<UploadWidget />);
    const classes = [...container.querySelectorAll('*')].flatMap((el) => [...el.classList]);
    expect(classes).not.toContain('fixed');
    expect(classes).not.toContain('absolute');
    expect(classes.filter((c) => /^(bottom|right|left|top|z)-/.test(c))).toEqual([]);
  });

  it('se résume à une pastille dépliable, le détail restant derrière un clic', async () => {
    useUploadStore.setState({
      uploads: [item({}), item({ id: 'u2', filename: 'sh020_v001.mov' })],
    });
    render(<UploadWidget />);
    // Replié : le compte, l'état — mais aucun nom de fichier n'occupe la rangée.
    const trigger = screen.getByRole('button', {
      name: triggerName(0, 2, t('uploads.sending', { pct: 40 })),
    });
    expect(trigger).toHaveTextContent('0/2');
    expect(screen.queryByText('sh010_v003.mov')).toBeNull();
    await userEvent.click(trigger);
    expect(await screen.findByText('sh010_v003.mov')).toBeInTheDocument();
    expect(screen.getByText('sh020_v001.mov')).toBeInTheDocument();
  });

  it('montre l’avancement d’ensemble sans qu’on le déplie — un envoi se suit', () => {
    useUploadStore.setState({ uploads: [item({ progress: 30 }), item({ id: 'u2', progress: 50 })] });
    const { container } = render(<UploadWidget />);
    const bars = [...container.querySelectorAll('span')].map((el) => el.style.width);
    expect(bars).toContain('40%');
  });

  /**
   * Le repli se faisait sous 1100 px, le seuil « fenêtre étroite » de la coquille. Contresens
   * assumé et corrigé : c'est la largeur où la rangée gagne le plus de place (la recherche y
   * tombe à une icône), et « voir le texte du statut pendant un upload » vise justement le
   * portable et la fenêtre partagée. Ce cas remplace celui qui figeait l'ancien comportement.
   */
  it('garde le texte d’état bien en dessous de 1100 px — portable, fenêtre partagée', () => {
    setViewportWidth(900);
    useUploadStore.setState({ uploads: [item({ progress: 30 })] });
    const { container } = render(<UploadWidget />);
    expect(screen.getByText(t('uploads.sending', { pct: 30 }))).toBeInTheDocument();
    expect([...container.querySelectorAll('span')].map((el) => el.style.width)).toContain('30%');
  });

  it('ne garde que le compte à la largeur d’un téléphone, où le fil d’Ariane n’a plus rien', () => {
    setViewportWidth(420);
    useUploadStore.setState({ uploads: [item({ progress: 30 })] });
    const { container } = render(<UploadWidget />);
    expect([...container.querySelectorAll('span')].map((el) => el.style.width)).not.toContain('30%');
    expect(screen.queryByText(t('uploads.sending', { pct: 30 }))).toBeNull();
    // Le x/y, lui, reste : c'est ce qui dit qu'un envoi est en cours et où il en est.
    const trigger = screen.getByRole('button', {
      name: triggerName(0, 1, t('uploads.sending', { pct: 30 })),
    });
    expect(trigger).toHaveTextContent('0/1');
  });

  /**
   * L'autre moitié de la contrainte : le texte visible ne doit pas chasser le fil d'Ariane de
   * la rangée. La pastille vit dans le flux (lot 13) et ne rétrécit pas — c'est donc au texte
   * d'être borné et de se tronquer, quelle que soit la longueur de la traduction.
   */
  it('borne le texte d’état : il se tronque au lieu de pousser le fil d’Ariane dehors', () => {
    setViewportWidth(900);
    useUploadStore.setState({ uploads: [item({ progress: 30 })] });
    render(<UploadWidget />);
    const classes = [...screen.getByText(t('uploads.sending', { pct: 30 })).classList];
    expect(classes).toContain('truncate');
    expect(classes.some((c) => /^max-w-\[/.test(c))).toBe(true);
  });

  /**
   * « x/y » : ce qui est arrivé sur ce qui a été demandé. Une ligne en échec n'est pas un
   * aboutissement — elle reste au dénominateur jusqu'à ce qu'on la retire, sans quoi une
   * pastille « 3/3 » annoncerait un envoi complet alors qu'un plan manque.
   */
  it('compte les lignes terminées sur le total, l’échec n’étant pas un aboutissement', () => {
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

  it('montre le texte de l’état en cours sans qu’on déplie — « on voit ce qui se passe »', () => {
    useUploadStore.setState({ uploads: [item({ status: 'uploading', progress: 42 })] });
    const { rerender } = render(<UploadWidget />);
    expect(screen.getByText(t('uploads.sending', { pct: 42 }))).toBeInTheDocument();
    // Et il suit la phase, pas seulement l'octet : le transcodage se lit aussi.
    useUploadStore.setState({ uploads: [item({ status: 'processing', kind: 'VIDEO' })] });
    rerender(<UploadWidget />);
    expect(screen.getByText(t('uploads.transcoding'))).toBeInTheDocument();
  });

  /**
   * Trois transferts montent à la fois, les suivants attendent : l'état *majoritaire* d'un
   * dépôt de trente plans resterait « En attente » du début à la fin. La pastille montre
   * donc la ligne la plus avancée — celle dont l'état changera le prochain.
   */
  it('choisit la ligne la plus avancée quand plusieurs sont en vol', () => {
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

  it('n’affiche aucun état au repos : tout est arrivé, il n’y a plus rien à raconter', () => {
    useUploadStore.setState({ uploads: [item({ status: 'done', progress: 100 })] });
    render(<UploadWidget />);
    expect(screen.getByRole('button', { name: triggerName(1, 1) })).toBeInTheDocument();
    expect(screen.queryByText(t('project.status.completed'))).toBeNull();
    expect(screen.queryByText(t('uploads.sending', { pct: 100 }))).toBeNull();
  });

  /**
   * « Rendre plus visible cet encart quand il est actif » : au repos c'est une icône de
   * barre parmi d'autres, en vol c'est une surface encadrée — celle de l'aperçu de la cloche.
   */
  it('se distingue d’une icône de barre quand un envoi est en vol', () => {
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

  it('ne laisse aucune trace quand la dernière ligne est retirée', () => {
    useUploadStore.setState({ uploads: [item({})] });
    const { container, rerender } = render(<UploadWidget />);
    useUploadStore.setState({ uploads: [] });
    rerender(<UploadWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * L'emplacement EST la correction demandée : un widget qui ne se positionne plus lui-même
 * doit être monté là où on veut le voir, sinon il part en fin d'arbre sans que rien ne le
 * dise. Aucune suite ne monte la coquille entière (elle tire la messagerie, la palette, le
 * temps réel et six requêtes) : on vérifie donc la composition à la source, sur le seul
 * fichier qui décide de l'emplacement.
 */
describe('Emplacement dans la coquille', () => {
  const shell = readFileSync('src/v2/components/Shell.tsx', 'utf8');
  const header = /<header[\s\S]*?<\/header>/.exec(shell)?.[0] ?? '';

  it('monte le suivi des envois dans la rangée d’en-tête, et nulle part ailleurs', () => {
    expect(header).toContain('<UploadWidget />');
    expect(shell.split('<UploadWidget />')).toHaveLength(2);
  });

  it('le place à gauche de la recherche, comme la cloche', () => {
    expect(header.indexOf('<UploadWidget />')).toBeLessThan(header.indexOf('<NotificationBell />'));
    expect(header.indexOf('<NotificationBell />')).toBeLessThan(header.indexOf("t('shell.search')"));
  });
});

describe('UploadRow', () => {
  it('ne laisse plus un seul libellé français en dur, quel que soit l’état', () => {
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

  it('distingue les états de traitement par type de média', () => {
    const video = row({ status: 'processing', kind: 'VIDEO' });
    const model = row({ status: 'processing', kind: 'MODEL_3D' });
    const image = row({ status: 'processing', kind: 'IMAGE' });
    expect(video).not.toBe(model);
    expect(model).not.toBe(image);
  });

  it('offre « annuler » sur un transfert vivant et « retirer » sur une ligne finie', () => {
    // Les libellés viennent du catalogue anglais de base, seul embarqué au démarrage.
    expect(row({ status: 'uploading' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'pending' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'finalizing' })).toContain('aria-label="Cancel"');
    expect(row({ status: 'done' })).toContain('aria-label="Remove"');
    expect(row({ status: 'error', error: 'boom' })).toContain('aria-label="Remove"');
  });

  it('montre le nom du fichier, sa progression et le motif d’échec', () => {
    const html = row({ status: 'error', progress: 60, error: 'PUT 403' });
    expect(html).toContain('sh010_v003.mov');
    expect(html).toContain('PUT 403');
    expect(html).toContain('60%');
  });

  it('remplace la barre par une attente indéterminée pendant le traitement serveur', () => {
    expect(row({ status: 'processing', progress: 100 })).toContain('animate-pulse');
    expect(row({ status: 'uploading', progress: 100 })).not.toContain('animate-pulse');
  });
});
