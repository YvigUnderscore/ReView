// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ArrowLeft, Box, Clapperboard, Film, LayoutDashboard, ListVideo } from 'lucide-react';
import Tabs from '../../components/Tabs';
import ClientMediaGrid, { GRID_CLASS } from './ClientMediaGrid';
import ClientListControls from './ClientListControls';
import {
  HOME,
  HOME_MEDIA_COUNT,
  coverUrl,
  filterMedia,
  mediaOfView,
  pendingMedia,
  shotsOfSequence,
  sortMedia,
  visibleTabs,
  type ClientSort,
  type ClientTab,
  type ClientView,
} from './clientBrowseModel';
import type { ClientMedia, ClientSharePayload } from '../../types/api';
import { useT, type Tr } from '../../i18n';

/**
 * Ce que l'invité parcourt : un accueil qui met en avant les playlists du lien et les
 * dernières livraisons, puis quatre onglets — Review à plat, Sequences, Shots, Assets.
 *
 * Aucun onglet vide n'est proposé : un lien qui n'ouvre qu'un asset ne doit pas nommer
 * « Sequences » pour rien. Et aucune tuile n'est fabriquée ici — les nœuds portent des
 * identifiants, `clientBrowseModel` les résout dans la page de médias déjà servie.
 */

/** Libellés d'onglet : une fonction, jamais une table de module — elle figerait la langue. */
const tabDefs = (t: Tr) => ({
  home: { label: t('nav.home'), icon: <LayoutDashboard size={16} /> },
  // Vocabulaire de production : « Review » ne se traduit dans aucune langue (glossaire).
  review: { label: 'Review', icon: <ListVideo size={16} /> },
  sequences: { label: t('sequences.title'), icon: <Film size={16} /> },
  shots: { label: t('shots.title'), icon: <Clapperboard size={16} /> },
  assets: { label: 'Assets', icon: <Box size={16} /> },
});

/** Carte d'un nœud : une vignette empruntée à un média, un nom, un décompte. */
function NodeCard({
  cover,
  title,
  subtitle,
  onClick,
}: {
  cover: string | null;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/60"
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-black/50">
        {cover && (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-xs font-medium">{title}</p>
        <p className="truncate text-2xs text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  );
}

export default function ClientBrowse({
  payload,
  view,
  onView,
  onOpen,
}: {
  payload: ClientSharePayload;
  view: ClientView;
  onView: (view: ClientView) => void;
  onOpen: (media: ClientMedia) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ClientSort>('recent');
  // `layout` et non `view` : `view` est déjà la vue de NAVIGATION (accueil, onglet, nœud).
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const media = payload.media ?? [];
  const browse = payload.browse;
  const playlists = browse?.playlists ?? [];
  const tabs = visibleTabs(media, browse);
  const defs = tabDefs(t);
  const canDecide = payload.permission === 'DECIDE';
  const pending = pendingMedia(media, canDecide);

  /** Ce que la vue montre, une fois cherché et trié. Les vues de nœud en héritent aussi. */
  const listed = (source: readonly ClientMedia[]) =>
    sortMedia(filterMedia(source, browse, query), browse, sort);
  const grid = (source: readonly ClientMedia[]) => (
    <>
      <ClientListControls
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        view={layout}
        onView={setLayout}
      />
      <ClientMediaGrid
        media={listed(source)}
        onOpen={onOpen}
        view={layout}
        empty={query.trim() ? t('client.noMatch') : undefined}
      />
    </>
  );

  // L'onglet actif pour la barre : une vue de nœud reste sous son onglet de rattachement,
  // pour que le fil d'Ariane ait un « retour » qui veuille dire quelque chose.
  const activeTab =
    view.kind === 'tab'
      ? view.tab
      : view.kind === 'sequence'
        ? 'sequences'
        : view.kind === 'shot'
          ? 'shots'
          : view.kind === 'asset'
            ? 'assets'
            : 'home';

  const tabList = [{ key: 'home', ...defs.home }, ...tabs.map((key) => ({ key, ...defs[key] }))];
  const goToTab = (key: string) => onView(key === 'home' ? HOME : { kind: 'tab', tab: key as ClientTab });

  const sequence = view.kind === 'sequence' ? browse?.sequences.find((s) => s.id === view.id) : undefined;
  const shot = view.kind === 'shot' ? browse?.shots.find((s) => s.id === view.id) : undefined;
  const asset = view.kind === 'asset' ? browse?.assets.find((a) => a.id === view.id) : undefined;
  const playlist = view.kind === 'playlist' ? playlists.find((p) => p.id === view.id) : undefined;
  const nodeTitle = sequence?.name ?? shot?.name ?? asset?.name ?? playlist?.name ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs tabs={tabList} active={activeTab} onChange={goToTab} />

      {/* Le décompte annoncé par les nœuds décrit la page servie, pas le projet : un lien qui
          montre trop doit être restreint, pas paginé devant un client. */}
      {payload.mediaHasMore && (
        <p className="mb-4 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          {t('client.partial', { value: media.length })}
        </p>
      )}

      {nodeTitle !== null && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => goToTab(activeTab)}
            aria-label={t('common.back')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={15} /> {defs[activeTab].label}
          </button>
          <h2 className="truncate text-sm font-semibold">{nodeTitle}</h2>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {view.kind === 'home' ? (
          <div className="space-y-8">
            {/* Ce que le lien contient, dit en une ligne : un client qui arrive doit savoir
                s'il a reçu un plan ou tout un épisode avant de cliquer où que ce soit. */}
            <p className="text-xs text-muted-foreground">
              {[
                browse?.sequences.length
                  ? t('client.sequenceCount', { count: browse.sequences.length })
                  : null,
                browse?.shots.length ? t('client.shotCount', { count: browse.shots.length }) : null,
                browse?.assets.length ? t('client.assetCount', { count: browse.assets.length }) : null,
                t('client.mediaCount', { count: payload.mediaTotal ?? media.length }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {/* Ce qui attend une réponse passe devant tout : c'est la question qu'on se pose
                en ouvrant un lien, et celle à laquelle une grille du plus récent au plus
                ancien ne répond jamais. */}
            {canDecide && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">{t('client.queue')}</h2>
                {pending.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('client.queueDone')}</p>
                ) : (
                  <ClientMediaGrid media={pending.slice(0, HOME_MEDIA_COUNT)} onOpen={onOpen} />
                )}
              </section>
            )}

            {playlists.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Playlists</h2>
                <div className={GRID_CLASS}>
                  {playlists.map((p) => (
                    <NodeCard
                      key={p.id}
                      cover={coverUrl(media, p.coverMediaIds[0] ?? null)}
                      title={p.name}
                      subtitle={t('client.mediaCount', { count: p.itemCount })}
                      onClick={() => onView({ kind: 'playlist', id: p.id })}
                    />
                  ))}
                </div>
              </section>
            )}
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{t('client.latest')}</h2>
                {media.length > HOME_MEDIA_COUNT && (
                  <button
                    onClick={() => onView({ kind: 'tab', tab: 'review' })}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('client.viewAll')}
                  </button>
                )}
              </div>
              <ClientMediaGrid media={media.slice(0, HOME_MEDIA_COUNT)} onOpen={onOpen} />
            </section>
          </div>
        ) : view.kind === 'tab' && view.tab === 'sequences' ? (
          <div className={GRID_CLASS}>
            {(browse?.sequences ?? []).map((s) => (
              <NodeCard
                key={s.id}
                cover={coverUrl(media, s.coverMediaId)}
                title={s.name}
                subtitle={t('client.shotCount', { count: s.shotIds.length })}
                onClick={() => onView({ kind: 'sequence', id: s.id })}
              />
            ))}
          </div>
        ) : view.kind === 'tab' && view.tab === 'shots' ? (
          <div className={GRID_CLASS}>
            {(browse?.shots ?? []).map((s) => (
              <NodeCard
                key={s.id}
                cover={coverUrl(media, s.coverMediaId)}
                title={s.name}
                subtitle={t('client.mediaCount', { count: s.mediaIds.length })}
                onClick={() => onView({ kind: 'shot', id: s.id })}
              />
            ))}
          </div>
        ) : view.kind === 'tab' && view.tab === 'assets' ? (
          <div className={GRID_CLASS}>
            {(browse?.assets ?? []).map((a) => (
              <NodeCard
                key={a.id}
                cover={coverUrl(media, a.coverMediaId)}
                title={a.name}
                subtitle={a.typeLabel ?? t('client.mediaCount', { count: a.mediaIds.length })}
                onClick={() => onView({ kind: 'asset', id: a.id })}
              />
            ))}
          </div>
        ) : sequence ? (
          // Une séquence montre ses plans, pas ses médias en vrac : c'est le niveau auquel
          // un client parle (« SH020 est trop sombre »).
          <div className={GRID_CLASS}>
            {shotsOfSequence(browse, sequence.id).map((s) => (
              <NodeCard
                key={s.id}
                cover={coverUrl(media, s.coverMediaId)}
                title={s.name}
                subtitle={t('client.mediaCount', { count: s.mediaIds.length })}
                onClick={() => onView({ kind: 'shot', id: s.id })}
              />
            ))}
          </div>
        ) : (
          grid(mediaOfView(view, media, browse, playlists))
        )}
      </div>
    </div>
  );
}
