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
 * Writing a note, block by block.
 *
 * The old editor was a text area with six buttons that inserted directives: one had to know that
 * `::progress Animation 60` made a gauge, and an image could only be a URL pasted from elsewhere. Here, each element
 * is a block that is added, adjusted and moved, images are dropped into the note, and the markdown, which remains the
 * saved format, never appears on screen.
 *
 * The state lives in blocks and is **serialised only on save**: converting back to markdown at every keystroke, only
 * to reparse it straight away, would have moved the cursor on every letter and merged two neighbouring blocks as soon
 * as one of them emptied.
 */
/**
 * Lateral displacement beyond which dragging changes a block's section.
 *
 * Wide enough that a slightly oblique vertical movement does not take a block out of its section unintentionally.
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
  /** The saved note, in markdown format. */
  initial: string;
  kind: NoteKind;
  id: number;
  projectId: number;
  /** Scope offered to templates: a shot brief is not an asset brief. */
  scope: NoteScope;
  busy?: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
  /** Warns the parent that there is unsaved work: the parent is the one holding the gate. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => {
    const parsed = toEditorBlocks(initial);
    // An empty note opens on a text block: nothing to click to start writing.
    return parsed.length > 0 ? parsed : [emptyBlock('text')];
  });
  // …and the cursor is already there. An existing note, on the other hand, opens in reading mode: one almost
  // always comes to change a specific passage, not to start over from the beginning.
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
   * Closing the tab, reloading, following a link: the browser asks for confirmation as long as there is unsaved
   * work. It is the only guard that holds when the page leaves without going through the application, such as a file
   * dropped beside a drop zone, which the browser opens in place of the page.
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
   * Where dropped images end up.
   *
   * On a board or an image block, they join that block itself. Pasted into text, they create a board right after it:
   * that is the gesture of a screenshot sent in the middle of writing, and interrupting it to ask where to file it
   * would have been pointless. Dropped somewhere in the window without targeting a block (`null`), they are appended
   * at the end: the only place that surprises nobody.
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
   * End of a drag: the vertical movement sorts, the lateral movement moves a block into or out of a section.
   *
   * Both happen in the same gesture, because it is the same gesture: one pulls a block to the right to put it in the
   * section above, and to the left to take it out. The threshold prevents a slightly oblique vertical movement from
   * changing membership without intent.
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

  /** Same thing from the keyboard, on the handle: ← leaves the section, → enters it. */
  const onDepthKey = (id: string, key: string) => {
    if (key === 'ArrowRight') setBlocks((prev) => setDepth(prev, id, 1));
    else if (key === 'ArrowLeft') setBlocks((prev) => setDepth(prev, id, 0));
  };

  /**
   * An image dropped beside the drop zone.
   *
   * Without this guard, the browser does what it always does with a file dropped on a page: it opens it. The note
   * being written then disappears with the page, and nothing warned. While the editor is open, the gesture is therefore
   * captured everywhere: inside the window, the image joins the end of the note; elsewhere, nothing happens at all.
   *
   * **In the capture phase** for the cancellation: in the bubble phase, a middle handler stopping propagation is
   * enough for the guard never to see the event, and the page leaves anyway. Capture goes before everyone.
   *
   * The landing, on the other hand, stays in the bubble phase: if it gets that far, no drop zone took it (they stop
   * propagation when they handle it), so the image was not added twice.
   */
  const surface = useRef<HTMLDivElement>(null);
  // The guard is set up once for the whole editing session; it reads the latest version of `onImages` through this
  // reference rather than resubscribing on each keystroke.
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
                      // Attached to its title, a block *shows* that it belongs to the section.
                      // The rule is also the target of the gesture: one drags it to leave the section.
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
