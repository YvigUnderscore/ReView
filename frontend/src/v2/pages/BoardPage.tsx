// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import PageShell from '../components/PageShell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import { useTheme } from '../stores/useTheme';
import { parseIdParam } from '../lib/slug';
import { useT } from '../i18n';
import BoardLibrary, { type MediaLite } from './board/BoardLibrary';
import { blobToDataURL } from './board/boardFiles';
import { useBoardDocument } from './board/useBoardDocument';
import type { BoardScope } from './board/boardApi';

/**
 * Board mood/reference (Excalidraw, MIT) — un board par Projet et un par Asset (9.B).
 * Le chargement, l'autosave et l'édition concurrente vivent dans `useBoardDocument` ; les
 * images collées sont déposées dans MinIO plutôt qu'embarquées en base64 dans le document
 * (cf. `board/boardFiles`). Drag-drop d'images natif + insertion depuis la bibliothèque
 * média (médias publiés du projet).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawApi = any;

const uid = () => Math.random().toString(36).slice(2, 10);
// Fichier Excalidraw construit hors du composant (règle react-hooks/purity : Date.now)
const makeBoardFile = (fileId: string, mimeType: string, dataURL: string) => ({
  id: fileId,
  mimeType: mimeType || 'image/jpeg',
  dataURL,
  created: Date.now(),
});

export default function BoardPage({ scope }: { scope: BoardScope }) {
  const t = useT();
  const { id } = useParams();
  const theme = useTheme((s) => s.theme);
  const targetId = parseIdParam(id);
  const [showLib, setShowLib] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const apiRef = useRef<ExcalidrawApi>(null);
  const board = useBoardDocument(scope, targetId);

  const insert = async (m: MediaLite) => {
    const ex = apiRef.current;
    if (!ex) return;
    try {
      const blob = await (await fetch(m.url)).blob();
      const dataURL = await blobToDataURL(blob);
      const fileId = uid();
      ex.addFiles([makeBoardFile(fileId, blob.type, dataURL)]);
      const els = convertToExcalidrawElements([
        { type: 'image', fileId, x: 80, y: 80, width: 320, height: 220 } as never,
      ]);
      ex.updateScene({ elements: [...ex.getSceneElements(), ...els] });
    } catch (e) {
      setInsertError(e instanceof Error ? e.message : t('board.insertFailed'));
    }
  };

  const initial = board.initial;
  if (!initial)
    return (
      <PageShell title="Board">
        <p className="text-sm text-muted-foreground">{t('board.loading')}</p>
      </PageShell>
    );

  const error = insertError ?? board.saveError ?? board.loadError;

  return (
    <PageShell
      title={scope === 'project' ? t('board.projectTitle') : t('board.assetTitle')}
      breadcrumb={
        <EntityBreadcrumb entity={scope === 'project' ? 'project' : 'asset'} id={targetId} tail="Board" />
      }
      width="fluid"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLib((s) => !s)}
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
          >
            {t('board.mediaLibrary')}
          </button>
          <span className="text-xs text-muted-foreground">
            {board.saved ? t('board.saved') : t('board.savingShort')}
          </span>
        </div>
        <Link
          to={scope === 'project' ? `/projects/${targetId}` : `/assets/${targetId}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t('common.back')}
        </Link>
      </div>
      {board.conflict && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="text-sm text-foreground">{t('board.conflictMessage')}</p>
          <button
            onClick={board.reload}
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
          >
            {t('board.conflictReload')}
          </button>
          <button
            onClick={board.overwrite}
            className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
          >
            {t('board.conflictOverwrite')}
          </button>
        </div>
      )}
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        {showLib && <BoardLibrary scope={scope} targetId={targetId} onInsert={(m) => void insert(m)} />}
        <div style={{ height: '78vh' }} className="flex-1 overflow-hidden rounded-lg border border-border">
          <Excalidraw
            key={board.mountKey}
            excalidrawAPI={(a: ExcalidrawApi) => {
              apiRef.current = a;
            }}
            initialData={{ elements: initial.elements as never, files: initial.files as never }}
            onChange={board.onChange}
            theme={theme}
          />
        </div>
      </div>
    </PageShell>
  );
}
