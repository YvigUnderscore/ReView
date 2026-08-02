import { useEffect, useRef } from 'react';
import type { Tool } from '../../components/AnnotationCanvas';
import type { ChromeState } from './chrome/chromeState';
import { DEFAULT_MODE } from './chrome/modes';
import type { ToolId } from './chrome/tools';
import type { Annotations } from './useAnnotations';

/**
 * Outils du rail sans implémentation dans les viewers plats : le lecteur vidéo n'a pas de
 * zoom, et la pipette d'inspection couleur n'existe pas encore côté image.
 */
export const VIDEO_HIDDEN_TOOLS: ToolId[] = ['zoom'];
export const IMAGE_HIDDEN_TOOLS: ToolId[] = ['pick'];

/** Traduction rail → outil du canvas d'annotation. */
const ANNOTATION_TOOL: Partial<Record<ToolId, Tool>> = {
  draw: 'draw',
  rect: 'rect',
  ellipse: 'ellipse',
  arrow: 'arrow',
  polygon: 'polygon',
  text: 'text',
  'shape-move': 'move',
  erase: 'erase',
};

/**
 * Fait suivre l'annotation au rail : entrer en mode « Annoter » arme le canvas, en sortir le
 * désarme, et l'outil choisi devient l'outil de tracé. Les tracés eux-mêmes restent gérés par
 * `useAnnotations` — seule la barre de palette disparaît, remplacée par le rail et les options.
 */
export function useMediaChrome({
  state,
  update,
  ann,
}: {
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  ann: Annotations;
}) {
  const { setTool, setAnnotating, annotating } = ann;
  const annotateMode = state.mode === 'annotate';
  const tool = ANNOTATION_TOOL[state.tool];

  useEffect(() => {
    setAnnotating(annotateMode);
  }, [annotateMode, setAnnotating]);

  // Le bouton « Annoter » du composer (et le clic droit) arment l'annotation sans passer par
  // la bascule — le chrome suit, dans les deux sens : entrer montre les outils de tracé au
  // rail, sortir ramène au repos. Déclenché par la **bascule** d'`annotating` seulement, pour
  // ne pas ré-imposer le mode quand l'utilisateur en choisit un autre (ce choix désarme
  // l'annotation via l'effet ci-dessus, pas l'inverse).
  const wasAnnotating = useRef(annotating);
  useEffect(() => {
    if (annotating === wasAnnotating.current) return;
    wasAnnotating.current = annotating;
    if (annotating) update({ mode: 'annotate' });
    else if (state.mode === 'annotate') update({ mode: DEFAULT_MODE });
  }, [annotating, state.mode, update]);

  useEffect(() => {
    if (tool) setTool(tool);
  }, [tool, setTool]);
}
