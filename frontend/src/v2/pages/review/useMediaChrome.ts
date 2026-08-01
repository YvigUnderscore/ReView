import { useEffect } from 'react';
import type { Tool } from '../../components/AnnotationCanvas';
import type { ChromeState } from './chrome/chromeState';
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
export function useMediaChrome({ state, ann }: { state: ChromeState; ann: Annotations }) {
  const { setTool, setAnnotating } = ann;
  const annotateMode = state.mode === 'annotate';
  const tool = ANNOTATION_TOOL[state.tool];

  useEffect(() => {
    setAnnotating(annotateMode);
  }, [annotateMode, setAnnotating]);

  useEffect(() => {
    if (tool) setTool(tool);
  }, [tool, setTool]);
}
