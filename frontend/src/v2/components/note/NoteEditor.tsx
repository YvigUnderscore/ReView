// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Eye, Pencil } from 'lucide-react';
import NoteView from './NoteView';
import NoteTemplateMenu from './NoteTemplateMenu';
import NoteBlockRow from './blocks/NoteBlockRow';
import NoteBlockInserter from './blocks/NoteBlockInserter';
import {
  emptyBlock,
  fromEditorBlocks,
  insertBlock,
  removeBlock,
  reorderBlocks,
  setDepth,
  toEditorBlocks,
  updateBlock,
  type EditorBlock,
  type EditorBlockKind,
} from './noteEditorModel';
import { isAcceptedNoteImage, NoteImageProvider, useNoteImageUrls } from './noteImages';
import { useNoteUploads } from './useNoteUploads';
import { Button } from '../ui/button';
import type { NoteKind, NoteScope } from '../../lib/notesApi';
import { useT } from '../../i18n';

/**
 * Écriture d'une fiche, bloc par bloc.
 *
 * L'ancien éditeur était une zone de texte et six boutons qui inséraient des directives :
 * il fallait savoir que `::progress Animation 60` faisait une jauge, et une image ne
 * pouvait être qu'une URL collée depuis ailleurs. Ici, chaque élément est un bloc qu'on
 * ajoute, règle et déplace, les images se déposent dans la fiche, et le markdown — qui
 * reste le format enregistré — n'apparaît jamais à l'écran.
 *
 * L'état vit en blocs et n'est **sérialisé qu'à l'enregistrement** : reconvertir en
 * markdown à chaque frappe pour le reparser aussitôt aurait déplacé le curseur à chaque
 * lettre et fondu deux blocs voisins dès qu'un d'eux se vidait.
 */
/**
 * Déplacement latéral au-delà duquel le glisser change l'appartenance à une section.
 *
 * Assez large pour qu'un mouvement vertical un peu oblique ne fasse pas sortir un bloc de
 * sa section sans qu'on l'ait demandé.
 */
const INDENT_THRESHOLD = 40;

export default function NoteEditor({
  initial,
  kind,
  id,
  projectId,
  scope,
  busy,
  onSave,
  onCancel,
  onDirtyChange,
}: {
  /** La fiche enregistrée, au format markdown. */
  initial: string;
  kind: NoteKind;
  id: number;
  projectId: number;
  /** Périmètre proposé aux modèles — un brief de plan n'en est pas un d'asset. */
  scope: NoteScope;
  busy?: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
  /** Prévient le parent qu'il y a du travail non enregistré — c'est lui qui garde la porte. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => {
    const parsed = toEditorBlocks(initial);
    // Une fiche vide s'ouvre sur un bloc de texte : rien à cliquer pour commencer à écrire.
    return parsed.length > 0 ? parsed : [emptyBlock('text')];
  });
  // …et le curseur y est déjà. Une fiche existante, elle, s'ouvre en lecture : on vient
  // presque toujours modifier un passage précis, pas repartir du début.
  const [focused, setFocused] = useState<string | null>(() => (initial.trim() ? null : blocks[0].id));
  const [preview, setPreview] = useState(false);

  const { upload, busy: uploading, urls: uploaded } = useNoteUploads(kind, id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const keys = useMemo(
    () =>
      blocks.flatMap((block) =>
        block.kind === 'gallery' ? block.images.map((i) => i.src) : block.kind === 'image' ? [block.src] : [],
      ),
    [blocks],
  );
  const { data: resolved } = useNoteImageUrls(keys);
  const resolve = useCallback((src: string) => uploaded[src] ?? resolved?.[src], [uploaded, resolved]);

  const body = () => fromEditorBlocks(blocks);
  const dirty = fromEditorBlocks(blocks) !== initial.trim();

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /**
   * Fermer l'onglet, recharger, suivre un lien : le navigateur demande confirmation tant
   * qu'il reste du travail non enregistré. C'est le seul garde-fou qui tienne quand la
   * page part sans passer par l'application — un fichier lâché à côté d'une zone de dépôt,
   * par exemple, que le navigateur ouvre à la place de la page.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const add = (index: number, kindToAdd: EditorBlockKind) => {
    const block = emptyBlock(kindToAdd);
    setBlocks((prev) => insertBlock(prev, index, block));
    setFocused(block.id);
  };

  /**
   * Où atterrissent les images déposées.
   *
   * Sur une planche ou un bloc image, elles rejoignent le bloc lui-même. Collées dans du
   * texte, elles créent une planche juste après — c'est le geste d'une capture d'écran
   * envoyée en pleine rédaction, et l'interrompre pour demander où la ranger n'aurait
   * servi à rien. Lâchées quelque part dans la fenêtre sans viser de bloc (`null`), elles
   * s'ajoutent à la fin : c'est le seul endroit qui ne surprend personne.
   */
  const onImages = async (blockId: string | null, files: File[]) => {
    const done = await upload(files);
    if (done.length === 0) return;
    const images = done.map((image) => ({ src: image.key, alt: image.alt }));

    setBlocks((prev) => {
      const found = blockId === null ? -1 : prev.findIndex((b) => b.id === blockId);
      const index = found === -1 ? prev.length - 1 : found;
      const target = found === -1 ? undefined : prev[found];
      if (target?.kind === 'gallery') {
        return updateBlock(prev, target.id, { images: [...target.images, ...images] });
      }
      if (target?.kind === 'image') {
        return updateBlock(prev, target.id, { src: images[0].src, alt: images[0].alt });
      }
      const block =
        images.length === 1 ? { ...emptyBlock('image'), ...images[0] } : { ...emptyBlock('gallery'), images };
      return insertBlock(prev, index, block);
    });
  };

  /**
   * Fin d'un glisser : le mouvement vertical range, le mouvement latéral fait entrer ou
   * sortir d'une section.
   *
   * Les deux dans le même geste, parce que c'est le même geste : on tire un bloc vers la
   * droite pour le mettre dans la section au-dessus, vers la gauche pour l'en sortir. Le
   * seuil évite qu'un déplacement vertical un peu oblique change l'appartenance sans
   * qu'on l'ait voulu.
   */
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    const id = String(active.id);

    if (Math.abs(delta.x) >= INDENT_THRESHOLD) {
      setBlocks((prev) => setDepth(prev, id, delta.x > 0 ? 1 : 0));
      return;
    }
    if (!over || active.id === over.id) return;
    const to = blocks.findIndex((block) => block.id === over.id);
    setBlocks((prev) => reorderBlocks(prev, id, to));
  };

  /** Même chose au clavier, sur la poignée : ← sort de la section, → y entre. */
  const onDepthKey = (id: string, key: string) => {
    if (key === 'ArrowRight') setBlocks((prev) => setDepth(prev, id, 1));
    else if (key === 'ArrowLeft') setBlocks((prev) => setDepth(prev, id, 0));
  };

  /**
   * Une image lâchée à côté de la zone de dépôt.
   *
   * Sans ce garde-fou, le navigateur fait ce qu'il fait toujours d'un fichier lâché sur une
   * page : il l'ouvre. La fiche en cours d'écriture disparaît alors avec la page, et rien
   * n'a prévenu. Tant que l'éditeur est ouvert, le geste est donc capté partout — dans la
   * fenêtre, l'image rejoint la fin de la fiche ; ailleurs, il ne se passe rien du tout.
   *
   * **En phase de capture** pour l'annulation : en phase de remontée, il suffit qu'un
   * gestionnaire intermédiaire arrête la propagation pour que le garde-fou ne voie jamais
   * l'événement — et la page part quand même. La capture passe avant tout le monde.
   *
   * L'atterrissage, lui, reste en remontée : s'il arrive jusque-là, c'est qu'aucune zone de
   * dépôt ne l'a pris (elles arrêtent la propagation quand elles traitent), et l'image n'a
   * donc pas été ajoutée deux fois.
   */
  const surface = useRef<HTMLDivElement>(null);
  // Le garde-fou se pose une fois pour toute la session d'édition ; il lit la dernière
  // version de `onImages` par cette référence plutôt que de se réabonner à chaque frappe.
  const latestOnImages = useRef(onImages);
  useEffect(() => {
    latestOnImages.current = onImages;
  });

  useEffect(() => {
    const hold = (e: DragEvent) => e.preventDefault();
    const land = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter(isAcceptedNoteImage);
      const inside = e.target instanceof Node && surface.current?.contains(e.target);
      if (inside && files.length > 0) void latestOnImages.current(null, files);
    };
    window.addEventListener('dragover', hold, true);
    window.addEventListener('drop', hold, true);
    window.addEventListener('drop', land);
    return () => {
      window.removeEventListener('dragover', hold, true);
      window.removeEventListener('drop', hold, true);
      window.removeEventListener('drop', land);
    };
  }, []);

  return (
    <NoteImageProvider value={resolve}>
      <div ref={surface} className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-1">
          <NoteTemplateMenu
            projectId={projectId}
            scope={scope}
            body={body()}
            onApply={(applied) => setBlocks(toEditorBlocks(applied))}
          />
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            title={preview ? t('note.edit') : t('note.preview')}
            aria-label={preview ? t('note.edit') : t('note.preview')}
            className="flex h-7 items-center gap-1 rounded border border-border px-1.5 text-2xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            {preview ? <Pencil size={13} /> : <Eye size={13} />}
            {preview ? t('note.edit') : t('note.preview')}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {preview ? (
            <NoteView source={body()} />
          ) : (
            <>
              <NoteBlockInserter onInsert={(k) => add(-1, k)} />
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  {blocks.map((block, index) => (
                    <div
                      key={block.id}
                      // Rattaché à son titre, un bloc *montre* qu'il est dans la section.
                      // Le filet est aussi la cible du geste : on tire dessus pour sortir.
                      className={block.depth === 1 ? 'ml-3 border-l-2 border-primary/40 pl-3' : ''}
                    >
                      <NoteBlockRow
                        block={block}
                        autoFocus={focused === block.id}
                        busy={uploading}
                        onChange={(patch) => setBlocks((prev) => updateBlock(prev, block.id, patch))}
                        onRemove={() => setBlocks((prev) => removeBlock(prev, block.id))}
                        onImages={(files) => void onImages(block.id, files)}
                        onDepthKey={(key) => onDepthKey(block.id, key)}
                      />
                      <NoteBlockInserter onInsert={(k) => add(index, k)} />
                    </div>
                  ))}
                </SortableContext>
              </DndContext>
              <NoteBlockInserter onInsert={(k) => add(blocks.length - 1, k)} always />
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={busy || uploading} onClick={() => onSave(body())}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </NoteImageProvider>
  );
}
