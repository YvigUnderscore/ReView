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
import { useLocale, useT } from '../i18n';
import BoardLibrary, { type MediaLite } from './board/BoardLibrary';
import { blobToDataURL } from './board/boardFiles';
import { useBoardDocument } from './board/useBoardDocument';
import type { BoardScope } from './board/boardApi';

/**
 * Board mood/reference (Excalidraw, MIT): one board per Project and one per Asset (9.B).
 * Loading, autosave and concurrent editing live in `useBoardDocument`; pasted
 * images are uploaded to MinIO rather than embedded as base64 in the document
 * (see `board/boardFiles`). Native image drag-drop + insertion from the media library
 * (published media of the project).
 *
 * **Undo/redo: Excalidraw's own, and nothing else.** The editor keeps its own history
 * (Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y on Windows), complete and faithful to each element of the scene.
 * Layering another on top would double it for no gain, and ours would not know what
 * Excalidraw knows. None of our handlers takes it from it: the shared registry
 * (`lib/undoScope`) is only mounted in the review, and the global shortcuts (`lib/shortcuts`)
 * step aside as soon as a key carries Ctrl. Undoing on a board is therefore its business;
 * the debounced autosave comes after, and saves the undone state like any other.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawApi = any;

/**
 * Our language codes mapped to those of Excalidraw, which has its own catalogue.
 *
 * Without `langCode`, the editor stays in English in all fourteen languages — "To move canvas,
 * hold mouse wheel…", "Shapes", "Library" — in the middle of a translated interface.
 *
 * Three of our languages do not exist on its side: Breton and Corsican fall back to
 * English, Alsatian to German, to which it is much closer.
 */
/* eslint-disable no-restricted-syntax --
   These are not formatting locales (dates, numbers) but the identifiers of the
   Excalidraw catalogue, which does not have the same set of codes as ours. `intlLocale()` has
   nothing to do with it here: the only question is "which Excalidraw translation file to load". */
const EXCALIDRAW_LANG: Record<string, string> = {
  en: 'en',
  fr: 'fr-FR',
  es: 'es-ES',
  de: 'de-DE',
  pt: 'pt-PT',
  'zh-Hans': 'zh-CN',
  ko: 'ko-KR',
  ja: 'ja-JP',
  hi: 'hi-IN',
  eu: 'eu-ES',
  oc: 'oc-FR',
  br: 'en',
  co: 'en',
  'gsw-FR': 'de-DE',
};
/* eslint-enable no-restricted-syntax */

const uid = () => Math.random().toString(36).slice(2, 10);
// Excalidraw file built outside the component (react-hooks/purity rule: Date.now)
const makeBoardFile = (fileId: string, mimeType: string, dataURL: string) => ({
  id: fileId,
  mimeType: mimeType || 'image/jpeg',
  dataURL,
  created: Date.now(),
});

export default function BoardPage({ scope }: { scope: BoardScope }) {
  const t = useT();
  const locale = useLocale();
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
            langCode={EXCALIDRAW_LANG[locale] ?? 'en'}
          />
        </div>
      </div>
    </PageShell>
  );
}
