import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PanelRightClose, PanelRightOpen, ImagePlus, X, RotateCcw, Move3d, Crosshair, Save, Orbit, Pencil, Play, Pause, Film } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuth } from '../stores/useAuth';
import { uploadCommentImages } from '../../lib/commentAttachments';
import Shell from '../components/Shell';
import ImageReviewViewer from '../components/ImageReviewViewer';
import ReviewComments, { type ReviewComment } from '../components/ReviewComments';
import { AnnotationCanvas, AnnotationToolbar, type Shape, type Tool } from '../components/AnnotationCanvas';
import SplatReviewViewer, { type SplatViewerHandle } from '../components/SplatReviewViewer';

interface Transform { yaw: number; pitch: number; roll: number; scale: number }
const DEFAULT_TRANSFORM: Transform = { yaw: 0, pitch: 0, roll: 0, scale: 1 };

interface Hotspot3D { position: string; normal: string }

/** Timecode HH:MM:SS:FF à partir d'un index de frame et du fps. */
function tcFromFrame(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const totalSec = Math.floor(f / fps);
  const ff = f % Math.round(fps);
  const ss = totalSec % 60, mm = Math.floor(totalSec / 60) % 60, hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/**
 * Encapsule le web component <model-viewer>.
 * - interpolation-decay : transition caméra fluide (~1 s) lors d'une restauration de vue.
 * - freeCamera : mode « libre » (non recentré sur l'asset). model-viewer reste orbital
 *   pour la rotation, mais le PANNING translate la cible/caméra librement dans l'espace.
 *   On déverrouille l'orbite + la focale et on désactive le recentrage (disable-tap),
 *   pour ne plus être contraint d'orbiter autour du centre du modèle.
 */
function ModelViewer({ src, innerRef, transform, hotspots, freeCamera, animationName }: {
  src: string; innerRef: React.RefObject<HTMLElement | null>; transform: Transform;
  hotspots: Hotspot3D[]; freeCamera: boolean; animationName?: string;
}) {
  const markers = hotspots.map((h, i) =>
    createElement('button', {
      key: i, slot: `hotspot-${i}`, className: 'mv-hotspot',
      'data-position': h.position, 'data-normal': h.normal,
    }, String(i + 1)),
  );
  return createElement('model-viewer', {
    ref: innerRef,
    src,
    'camera-controls': true,
    'touch-action': 'pan-y',
    'environment-image': 'neutral',
    exposure: '1',
    'shadow-intensity': '1',
    'interaction-prompt': 'none',
    'interpolation-decay': '200',
    ...(animationName ? { 'animation-name': animationName } : {}),
    ...(freeCamera
      ? {
          // Orbite et focale déverrouillées + pas de recentrage : déplacement libre par panning.
          'min-camera-orbit': 'auto 0deg 0m', 'max-camera-orbit': 'auto 180deg Infinity',
          'min-field-of-view': '5deg', 'max-field-of-view': '120deg', 'disable-tap': true,
        }
      : {}),
    orientation: `${transform.roll}deg ${transform.pitch}deg ${transform.yaw}deg`,
    scale: `${transform.scale} ${transform.scale} ${transform.scale}`,
    style: { width: '100%', height: '100%', backgroundColor: 'transparent', '--poster-color': 'transparent' },
  }, ...markers);
}

interface MediaResp {
  media: { id: number; kind: string; originalName: string; status: string; versionId: number; published: boolean };
  url: string;
  thumbnailUrl: string | null;
  proxyUrl: string | null;
  glbUrl: string | null;
  startFrame: number;
  fps: number | null;
}

// Type minimal des méthodes model-viewer utilisées (caméra + raycast + animations).
interface ModelViewerEl extends HTMLElement {
  getBoundingClientRect: () => DOMRect;
  positionAndNormalFromPoint?: (x: number, y: number) => { position: { toString(): string }; normal: { toString(): string } } | null;
  getCameraOrbit?: () => { theta: number; phi: number; radius: number };
  getCameraTarget?: () => { x: number; y: number; z: number };
  getFieldOfView?: () => number;
  cameraOrbit?: string; cameraTarget?: string; fieldOfView?: string;
  availableAnimations?: string[];
  loaded?: boolean;
  play?: (opts?: { repetitions?: number }) => void;
  pause?: () => void;
}

interface ModelCamera { orbit: { theta: number; phi: number; radius: number }; target?: { x: number; y: number; z: number }; fov?: number; aspect?: number }

/** Timeline vidéo avec marqueurs de commentaires horodatés. */
function VideoTimeline({ currentTime, duration, comments, selectedId, onSeek, onSelectComment }: {
  currentTime: number; duration: number;
  comments: ReviewComment[]; selectedId: number | null;
  onSeek: (t: number) => void; onSelectComment: (c: ReviewComment) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const timedComments = comments.filter((c) => c.timestamp != null);

  const seekFromEvent = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  }, [duration, onSeek]);

  return (
    <div
      ref={barRef}
      className="relative h-8 shrink-0 cursor-pointer select-none rounded-md border border-border bg-card/60 px-1"
      onClick={seekFromEvent}
      title="Cliquer pour se déplacer"
    >
      {/* Fond progress */}
      <div className="absolute inset-y-0 left-1 right-1 overflow-hidden rounded">
        <div className="h-full rounded bg-secondary/40" />
        <div
          className="absolute inset-y-0 left-0 rounded bg-primary/30 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Curseur de lecture */}
      <div
        className="absolute top-0 bottom-0 w-0.5 rounded-full bg-primary z-10 pointer-events-none"
        style={{ left: `calc(${progress * 100}% * (100% - 8px) / 100% + 4px)` }}
      />

      {/* Marqueurs de commentaires */}
      {timedComments.map((c) => {
        const pos = (c.timestamp! / duration) * 100;
        const selected = c.id === selectedId;
        return (
          <button
            key={c.id}
            className={`absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all
              ${selected ? 'h-4 w-4 border-primary bg-primary shadow-[0_0_0_2px_rgba(var(--primary)/0.3)]' : 'h-3 w-3 border-primary/60 bg-primary/40 hover:h-4 hover:w-4 hover:border-primary hover:bg-primary/80'}`}
            style={{ left: `calc(${pos}% * (100% - 8px) / 100% + 4px)` }}
            title={`${c.author?.name ?? 'Inconnu'} : ${c.content.slice(0, 60)}`}
            onClick={(e) => { e.stopPropagation(); onSelectComment(c); }}
          />
        );
      })}

      {/* Timecode affiché à droite */}
      <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground pointer-events-none">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function ReviewPage() {
  const { mediaId } = useParams();
  const id = Number(mediaId);
  const userId = useAuth((s) => s.user?.id) ?? 0;
  const role = useAuth((s) => s.user?.role);
  const canEditTransform = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';

  const [data, setData] = useState<MediaResp | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [content, setContent] = useState('');
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [transform, setTransform] = useState<Transform>(DEFAULT_TRANSFORM);
  const [savedTf, setSavedTf] = useState(false);
  const [model3dError, setModel3dError] = useState(false);
  const [freeCamera, setFreeCamera] = useState(false);
  // Animations du modèle 3D (si présentes dans le GLB)
  const [animations, setAnimations] = useState<string[]>([]);
  const [currentAnim, setCurrentAnim] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const modelRef = useRef<HTMLElement | null>(null);
  const splatRef = useRef<SplatViewerHandle>(null);
  const composerFileRef = useRef<HTMLInputElement>(null);

  // Annotation 2D (image/vidéo/3D/splat)
  const [tool, setTool] = useState<Tool>('draw');
  const [color, setColor] = useState('#ef4444');
  const [alpha, setAlpha] = useState(1);
  const [penWidth, setPenWidth] = useState(3);
  const [annot, setAnnot] = useState<Shape[]>([]);
  const [past, setPast] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  const [viewed, setViewed] = useState<Shape[] | null>(null);
  const [annotating, setAnnotating] = useState(false);
  // Métriques vidéo
  const [currentFrame, setCurrentFrame] = useState(0);
  const [fpsOverride, setFpsOverride] = useState(24);
  const [duration, setDuration] = useState(0);
  // Hotspots 3D
  const [hotspot3d, setHotspot3d] = useState<Hotspot3D | null>(null);
  const [viewed3d, setViewed3d] = useState<Hotspot3D | null>(null);
  // Commentaire actuellement affiché (carte mise en avant + annotation visible)
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  // Ratio largeur/hauteur du viewer au moment de l'annotation affichée (3D/splat)
  const [viewedAspect, setViewedAspect] = useState<number | null>(null);

  const mv = () => modelRef.current as ModelViewerEl | null;

  // Place un hotspot sur la surface au centre du viewer (raycast au point central).
  const placeHotspotCenter = () => {
    const m = mv();
    if (!m?.positionAndNormalFromPoint) return;
    const r = m.getBoundingClientRect();
    const res = m.positionAndNormalFromPoint(r.width / 2, r.height / 2);
    if (res) setHotspot3d({ position: res.position.toString(), normal: res.normal.toString() });
  };

  const setAnnotH = (next: Shape[]) => { setPast((p) => [...p, annot]); setFuture([]); setAnnot(next); };
  const undo = () => setPast((p) => { if (!p.length) return p; const prev = p[p.length - 1]!; setFuture((f) => [annot, ...f]); setAnnot(prev); return p.slice(0, -1); });
  const redo = () => setFuture((f) => { if (!f.length) return f; const nx = f[0]!; setPast((p) => [...p, annot]); setAnnot(nx); return f.slice(1); });
  const clearAnnot = () => setAnnotH([]);

  const loadComments = () => api.get<{ comments: ReviewComment[] }>(`/api/comments?mediaObjectId=${id}`).then((d) => setComments(d.comments));
  useEffect(() => {
    api.get<MediaResp>(`/api/media/${id}`).then(setData).catch((e) => setError(e.message));
    loadComments().catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (data?.media.kind === 'MODEL_3D') {
      setModel3dError(false);
      import('@google/model-viewer').catch(() => setError('Visionneuse 3D indisponible'));
      api.get<{ version: { transform: Partial<Transform> | null } }>(`/api/versions/${data.media.versionId}`)
        .then(({ version }) => { if (version.transform) setTransform({ ...DEFAULT_TRANSFORM, ...version.transform }); })
        .catch(() => undefined);
    }
  }, [data?.media.kind, data?.media.versionId]);

  // Applique orientation/échelle au modèle (live) + écoute l'erreur de chargement.
  useEffect(() => {
    const m = mv();
    if (m && data?.media.kind === 'MODEL_3D') {
      m.setAttribute('orientation', `${transform.roll}deg ${transform.pitch}deg ${transform.yaw}deg`);
      m.setAttribute('scale', `${transform.scale} ${transform.scale} ${transform.scale}`);
      const onErr = () => setModel3dError(true);
      m.addEventListener('error', onErr);
      return () => m.removeEventListener('error', onErr);
    }
  }, [transform, data?.media.kind, data?.url]);

  // Détecte les animations du GLB une fois chargé (availableAnimations).
  useEffect(() => {
    const m = mv();
    if (!m || data?.media.kind !== 'MODEL_3D') return;
    const readAnims = () => {
      const av = (m.availableAnimations ?? []) as string[];
      setAnimations(av);
      setCurrentAnim((c) => (c && av.includes(c) ? c : av[0] ?? null));
      setPlaying(false);
    };
    if (m.loaded) readAnims();
    m.addEventListener('load', readAnims);
    return () => m.removeEventListener('load', readAnims);
  }, [data?.media.kind, data?.glbUrl, data?.url]);

  const playAnim = () => {
    const m = mv();
    if (!m) return;
    if (currentAnim) m.setAttribute('animation-name', currentAnim);
    m.play?.({ repetitions: Infinity });
    setPlaying(true);
  };
  const pauseAnim = () => { mv()?.pause?.(); setPlaying(false); };
  const selectAnim = (name: string) => {
    setCurrentAnim(name);
    const m = mv();
    if (m) { m.setAttribute('animation-name', name); if (playing) m.play?.({ repetitions: Infinity }); }
  };

  // Mise à jour live de la transformation : état + application immédiate sur le modèle.
  // model-viewer met en pause son rendu à l'arrêt : on le réveille en réécrivant
  // l'orbite courante (valeur identique → pas de mouvement, mais une frame est rendue).
  const updateTransform = (patch: Partial<Transform>) => {
    setTransform((t) => {
      const next = { ...t, ...patch };
      const m = mv();
      if (m) {
        m.setAttribute('orientation', `${next.roll}deg ${next.pitch}deg ${next.yaw}deg`);
        m.setAttribute('scale', `${next.scale} ${next.scale} ${next.scale}`);
        const o = m.getCameraOrbit?.();
        if (o) m.cameraOrbit = `${o.theta}rad ${o.phi}rad ${o.radius}m`;
      }
      return next;
    });
  };

  const saveTransform = async () => {
    if (!data) return;
    try {
      await api.patch(`/api/versions/${data.media.versionId}`, { transform });
      setSavedTf(true); setTimeout(() => setSavedTf(false), 1500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };

  // Capture l'état caméra du modèle 3D (orbite + cible + focale + ratio) pour rejouer la vue.
  const captureModelCamera = (): ModelCamera | undefined => {
    const m = mv();
    if (!m?.getCameraOrbit) return undefined;
    const r = m.getBoundingClientRect();
    return {
      orbit: m.getCameraOrbit(), target: m.getCameraTarget?.(), fov: m.getFieldOfView?.(),
      aspect: r.height > 0 ? r.width / r.height : undefined,
    };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && attachFiles.length === 0) return;
    const kind = data?.media.kind;
    const timestamp = kind === 'VIDEO' && videoRef.current ? videoRef.current.currentTime : undefined;
    let cameraState: unknown;
    if (kind === 'MODEL_3D') cameraState = captureModelCamera();
    else if (kind === 'SPLAT') cameraState = splatRef.current?.getCameraState() ?? undefined;

    // Annotation : 3D = hotspot (au centre) + dessins 2D ; autres = dessins 2D.
    let annotation: unknown;
    if (kind === 'MODEL_3D') {
      const parts: unknown[] = [];
      if (hotspot3d) parts.push({ type: 'hotspot', position: hotspot3d.position, normal: hotspot3d.normal });
      parts.push(...annot);
      annotation = parts.length ? parts : undefined;
    } else {
      annotation = annot.length ? annot : undefined;
    }

    setSending(true);
    try {
      const attachments = attachFiles.length > 0 ? await uploadCommentImages(attachFiles) : undefined;
      await api.post('/api/comments', { mediaObjectId: id, content: content || '(image)', timestamp, cameraState, annotation, attachments });
      setContent(''); setAttachFiles([]);
      setAnnot([]); setPast([]); setFuture([]); setHotspot3d(null); setAnnotating(false);
      loadComments();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
    finally { setSending(false); }
  };

  // Restaure une vue caméra avec une transition fluide (~1 s).
  const restoreCamera = (cs: unknown) => {
    if (data?.media.kind === 'SPLAT') { splatRef.current?.animateToCameraState(cs, 1000); return; }
    // Modèle 3D : model-viewer interpole vers le but (interpolation-decay ≈ 1 s).
    const m = mv();
    const snap = cs as ModelCamera | null;
    if (m && snap?.orbit) {
      m.cameraOrbit = `${snap.orbit.theta}rad ${snap.orbit.phi}rad ${snap.orbit.radius}m`;
      if (snap.target) m.cameraTarget = `${snap.target.x}m ${snap.target.y}m ${snap.target.z}m`;
      if (snap.fov != null) m.fieldOfView = `${snap.fov}deg`;
    }
  };

  // Drapeau : distingue un seek programmatique d'un déplacement manuel (qui désélectionne).
  const programmaticSeek = useRef(false);
  const seek = (t: number | null) => {
    if (t != null && videoRef.current) { programmaticSeek.current = true; videoRef.current.currentTime = t; }
  };
  const stepFrame = (delta: number) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta / fps);
  };

  // Désélectionne le commentaire courant et masque toute annotation affichée.
  const clearSelection = () => {
    setSelectedCommentId(null);
    setViewed(null);
    setViewed3d(null);
    setViewedAspect(null);
  };

  // Déplacement manuel dans la vidéo → on cache l'annotation et on désélectionne.
  const onVideoSeeking = () => {
    if (programmaticSeek.current) { programmaticSeek.current = false; return; }
    clearSelection();
  };

  // Démarre/arrête l'annotation. À l'ouverture sur un modèle 3D, place un hotspot au centre.
  const toggleAnnotating = () => {
    setAnnotating((prev) => {
      const next = !prev;
      if (next) {
        clearSelection();
        if (data?.media.kind === 'MODEL_3D') setTimeout(placeHotspotCenter, 0);
      }
      return next;
    });
  };

  // Sélection d'un commentaire : restaure ensemble seek + annotation 2D/3D + caméra (animée).
  const selectComment = (c: ReviewComment) => {
    setSelectedCommentId(c.id);
    const a = c.annotation as Array<{ type?: string; position?: string; normal?: string }> | null;
    if (Array.isArray(a)) {
      const hs = a.find((x) => x?.type === 'hotspot');
      const shapes = a.filter((x) => x && (x as { type?: string }).type !== 'hotspot');
      setViewed3d(hs?.position && hs.normal ? { position: hs.position, normal: hs.normal } : null);
      if (shapes.length > 0) { setAnnotating(false); setViewed(shapes as unknown as Shape[]); }
      else setViewed(null);
    } else { setViewed(null); setViewed3d(null); }
    // Ratio capturé (3D: cameraState.aspect ; splat: cameraState.aspectRatio) pour caler l'overlay
    const cam = c.cameraState as { aspect?: number; aspectRatio?: number } | null;
    setViewedAspect(cam?.aspect ?? cam?.aspectRatio ?? null);
    if (c.timestamp != null) seek(c.timestamp);
    if (c.cameraState != null) restoreCamera(c.cameraState);
  };

  const publishMedia = async () => {
    if (!data) return;
    try {
      const { media } = await api.post<{ media: MediaResp['media'] }>(`/api/media/${id}/publish`);
      setData({ ...data, media: { ...data.media, published: media.published } });
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
  };

  const [reprocessing, setReprocessing] = useState(false);
  const reprocessMedia = async () => {
    if (!data) return;
    setReprocessing(true);
    setError(null);
    try {
      await api.post(`/api/media/${id}/reprocess`);
      const fresh = await api.get<MediaResp>(`/api/media/${id}`);
      setData(fresh);
      setModel3dError(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur'); }
    finally { setReprocessing(false); }
  };

  const kind = data?.media.kind;
  const src = data?.proxyUrl ?? data?.url;
  const fps = data?.fps ?? fpsOverride;
  const startFrame = data?.startFrame ?? 1001;
  const published = data?.media.published ?? false;
  // Outils d'édition 3D masqués une fois publié : le dernier état enregistré (version.transform)
  // reste appliqué au modèle, mais on ne propose plus de le modifier.
  const showEditTools = canEditTransform && !published;
  // GLB exploitable : conversion réussie, ou original déjà au format glTF
  const glbSrc = data?.glbUrl ?? (/\.(glb|gltf)(\?|$)/i.test(data?.url ?? '') ? data?.url : null);
  const model3dReady = kind === 'MODEL_3D' && data?.media.status !== 'PROCESSING' && glbSrc && !model3dError;
  // Overlay d'annotation 2D ; `captureAspect` (3D/splat) cale le dessin malgré un viewer
  // de taille différente. Le wrapper est en pointer-events-none : en lecture on peut
  // toujours orbiter (l'iframe/modèle reçoit les events) ; en édition la SVG les capte.
  const renderOverlay = (captureAspect?: number) => (annotating || viewed) ? (
    <AnnotationCanvas shapes={viewed ?? annot} onChange={setAnnotH} editable={annotating && !viewed} tool={tool} color={color} width={penWidth} alpha={alpha} captureAspect={captureAspect} />
  ) : null;
  const overlayPlain = renderOverlay();
  const overlay3dSplat = renderOverlay(viewedAspect ?? undefined);

  return (
    <Shell title={data?.media.originalName ?? 'Review'}>
      <div className="flex h-[calc(100vh-7rem)] flex-col">
        {/* En-tête compact */}
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-lg font-semibold">{data?.media.originalName ?? 'Média'}</h1>
            {data && !published && (
              <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Brouillon</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            {data && !published && (
              <button onClick={publishMedia} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Publier pour l’équipe</button>
            )}
            <button onClick={() => setCommentsOpen((o) => !o)} title={commentsOpen ? 'Masquer les commentaires' : 'Afficher les commentaires'} className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
              {commentsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </button>
            <Link to="/" className="text-muted-foreground hover:text-foreground">← Projets</Link>
          </div>
        </div>
        {error && <p className="mb-2 shrink-0 text-sm text-destructive">{error}</p>}

        {/* Corps : viewer (large) + commentaires (panneau) */}
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Colonne viewer */}
          <section className="flex min-w-0 flex-1 flex-col gap-2">
            {(kind === 'IMAGE' || kind === 'VIDEO' || kind === 'SPLAT' || model3dReady) && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  onClick={toggleAnnotating}
                  className={`flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm ${annotating ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary/60'}`}
                >
                  <Pencil size={14} /> {annotating ? 'Terminer l’annotation' : 'Annoter'}
                </button>
                {viewed && <button onClick={clearSelection} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60">Masquer l’annotation</button>}
                {annotating && kind === 'MODEL_3D' && (
                  <button onClick={placeHotspotCenter} title="Replacer le hotspot au centre du viewer" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60">
                    <Crosshair size={14} /> Recentrer le hotspot
                  </button>
                )}
                {annotating && (
                  <AnnotationToolbar
                    tool={tool} setTool={setTool} color={color} setColor={setColor} width={penWidth} setWidth={setPenWidth}
                    alpha={alpha} setAlpha={setAlpha}
                    onUndo={undo} onRedo={redo} onClear={clearAnnot} canUndo={past.length > 0} canRedo={future.length > 0}
                  />
                )}
              </div>
            )}

            {/* Zone média (occupe tout l'espace) */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-black/40">
              {kind === 'VIDEO' && src && (
                <div className="relative inline-block max-h-full">
                  <video
                    ref={videoRef} src={src} controls className="block max-h-[calc(100vh-16rem)] max-w-full"
                    onTimeUpdate={(e) => setCurrentFrame(Math.round(e.currentTarget.currentTime * fps))}
                    onLoadedMetadata={(e) => { setCurrentFrame(Math.round(e.currentTarget.currentTime * fps)); setDuration(e.currentTarget.duration); }}
                    onSeeking={onVideoSeeking}
                  />
                  {overlayPlain}
                </div>
              )}

              {kind === 'IMAGE' && data?.url && (
                <div className="absolute inset-0">
                  <ImageReviewViewer
                    src={data.url} alt={data.media.originalName}
                    shapes={viewed ?? annot} onChange={setAnnotH} editable={annotating && !viewed}
                    tool={tool} color={color} width={penWidth} alpha={alpha}
                  />
                </div>
              )}

              {kind === 'MODEL_3D' && data?.media.status === 'PROCESSING' && (
                <div className="text-center text-sm text-muted-foreground">Conversion 3D en cours… (rechargez dans un instant)</div>
              )}
              {kind === 'MODEL_3D' && data?.media.status !== 'PROCESSING' && (
                model3dReady ? (
                  <>
                    <ModelViewer
                      src={glbSrc!} innerRef={modelRef} transform={transform} freeCamera={freeCamera}
                      hotspots={viewed3d ? [viewed3d] : hotspot3d ? [hotspot3d] : []}
                      animationName={currentAnim ?? undefined}
                    />
                    {/* Overlay de dessin 2D superposé au modèle (s'aligne via la vue caméra) */}
                    {overlay3dSplat && <div className="absolute inset-0 pointer-events-none">{overlay3dSplat}</div>}
                  </>
                ) : (
                  <div className="max-w-sm space-y-3 p-6 text-center text-sm text-muted-foreground">
                    <p>
                      Modèle 3D non affichable : le fichier n’a pas pu être converti en GLB.
                      Relancez la conversion, ou ré-uploadez un GLB/glTF.
                    </p>
                    {role !== 'CLIENT' && (
                      <button
                        onClick={reprocessMedia}
                        disabled={reprocessing}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        <RotateCcw size={13} /> {reprocessing ? 'Relance…' : 'Relancer la conversion'}
                      </button>
                    )}
                  </div>
                )
              )}

              {kind === 'SPLAT' && data?.url && (
                <SplatReviewViewer ref={splatRef} src={`/supersplat-viewer/index.html?content=${encodeURIComponent(data.url)}`}>
                  {overlay3dSplat && <div className="absolute inset-0 pointer-events-none">{overlay3dSplat}</div>}
                </SplatReviewViewer>
              )}
            </div>

            {/* Timeline vidéo avec marqueurs de commentaires */}
            {kind === 'VIDEO' && duration > 0 && (
              <VideoTimeline
                currentTime={currentFrame / fps}
                duration={duration}
                comments={comments}
                selectedId={selectedCommentId}
                onSeek={(t) => { if (videoRef.current) { programmaticSeek.current = true; videoRef.current.currentTime = t; } }}
                onSelectComment={selectComment}
              />
            )}

            {/* Barre de métriques vidéo */}
            {kind === 'VIDEO' && (
              <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
                <span className="font-mono text-sm">Frame <span className="text-primary">{startFrame + currentFrame}</span></span>
                <span className="text-muted-foreground">TC {tcFromFrame(currentFrame, fps)}</span>
                <span className="text-muted-foreground">|</span>
                <button onClick={() => stepFrame(-1)} title="Frame précédente" className="rounded border border-border px-2 py-0.5 hover:bg-secondary/60">◀ -1</button>
                <button onClick={() => stepFrame(1)} title="Frame suivante" className="rounded border border-border px-2 py-0.5 hover:bg-secondary/60">+1 ▶</button>
                <span className="text-muted-foreground">|</span>
                <label className="flex items-center gap-1 text-muted-foreground">
                  fps
                  <input type="number" value={fpsOverride} min={1} max={120} disabled={data?.fps != null}
                    onChange={(e) => setFpsOverride(Number(e.target.value) || 24)}
                    className="w-14 rounded border border-input bg-background px-1 py-0.5 disabled:opacity-60" />
                  {data?.fps != null && <span className="text-[10px]">(détecté)</span>}
                </label>
              </div>
            )}

            {/* Outils 3D : caméra libre + transformation (édition masquée une fois publié) */}
            {model3dReady && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
                <button
                  onClick={() => setFreeCamera((f) => !f)}
                  title="Déplacement libre (non recentré) : orbite/focale déverrouillées + translation par panning"
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors ${freeCamera ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-secondary/60'}`}
                >
                  <Orbit size={14} /> Caméra libre
                </button>
                {freeCamera && <span className="text-[11px] text-muted-foreground">Translation : clic droit / Maj+glisser / 2 doigts</span>}
                {animations.length > 0 && (
                  <>
                    <span className="mx-1 h-5 w-px bg-border" />
                    <button
                      onClick={playing ? pauseAnim : playAnim}
                      title={playing ? 'Pause' : 'Lire l’animation'}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors ${playing ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-secondary/60'}`}
                    >
                      {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Animation'}
                    </button>
                    {animations.length > 1 ? (
                      <label className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
                        <Film size={13} />
                        <select value={currentAnim ?? ''} onChange={(e) => selectAnim(e.target.value)} className="rounded border border-input bg-background px-1 py-0.5 text-xs text-foreground">
                          {animations.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </label>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{currentAnim}</span>
                    )}
                  </>
                )}
                {showEditTools && (
                  <>
                    <span className="mx-1 h-5 w-px bg-border" />
                    <Move3d size={14} className="text-muted-foreground" />
                    {(['yaw', 'pitch', 'roll'] as const).map((axis) => (
                      <label key={axis} className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
                        <span className="w-9 uppercase tracking-wide">{axis}</span>
                        <input type="range" min={-180} max={180} step={1} value={transform[axis]}
                          onChange={(e) => updateTransform({ [axis]: Number(e.target.value) })} className="w-24" />
                        <span className="w-9 text-right font-mono text-foreground">{transform[axis]}°</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground">
                      <span className="uppercase tracking-wide">éch.</span>
                      <input type="range" min={0.1} max={5} step={0.1} value={transform.scale}
                        onChange={(e) => updateTransform({ scale: Number(e.target.value) })} className="w-24" />
                      <span className="w-8 text-right font-mono text-foreground">{transform.scale.toFixed(1)}</span>
                    </label>
                    <button onClick={saveTransform} className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground">
                      <Save size={13} /> {savedTf ? 'Enregistré' : 'Enregistrer'}
                    </button>
                    <button onClick={() => updateTransform(DEFAULT_TRANSFORM)} title="Réinitialiser la transformation" className="flex items-center justify-center rounded-md border border-border p-1.5 hover:bg-secondary/60">
                      <RotateCcw size={13} />
                    </button>
                  </>
                )}
              </div>
            )}
            {kind === 'SPLAT' && role !== 'CLIENT' && !published && (
              <div className="shrink-0">
                <Link to={`/editor/${id}`} className="inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60">✎ Éditer dans SuperSplat</Link>
              </div>
            )}
          </section>

          {/* Panneau commentaires */}
          {commentsOpen && (
            <aside className="flex w-[380px] shrink-0 flex-col rounded-lg border border-border bg-card">
              <div className="shrink-0 border-b border-border px-4 py-2.5 text-sm font-semibold">
                Commentaires <span className="text-muted-foreground">· {comments.length}</span>
              </div>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-4">
                <ReviewComments
                  comments={comments} mediaObjectId={id} currentUserId={userId} currentUserRole={role}
                  reload={loadComments} fps={fps} startFrame={startFrame}
                  selectedId={selectedCommentId} onSelect={selectComment}
                />
              </div>
              <form onSubmit={submit} className="shrink-0 border-t border-border p-3">
                {attachFiles.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {attachFiles.map((f, i) => (
                      <span key={i} className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px]">
                        {f.name}<button type="button" onClick={() => setAttachFiles((fs) => fs.filter((_, j) => j !== i))}><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                )}
                {annot.length > 0 && <p className="mb-1.5 text-[11px] text-primary">✏️ Annotation jointe</p>}
                {hotspot3d && <p className="mb-1.5 text-[11px] text-primary">📍 Hotspot joint (centre du viewer)</p>}
                {(kind === 'SPLAT' || kind === 'MODEL_3D') && annotating && <p className="mb-1.5 text-[11px] text-primary">📷 La vue caméra actuelle sera enregistrée</p>}
                <textarea
                  className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={2} placeholder="Ajouter un commentaire…" value={content} onChange={(e) => setContent(e.target.value)}
                />
                <div className="mt-2 flex items-center justify-between">
                  <input ref={composerFileRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => { setAttachFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])]); if (composerFileRef.current) composerFileRef.current.value = ''; }} />
                  <button type="button" onClick={() => composerFileRef.current?.click()} title="Joindre une image" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <ImagePlus size={16} />
                  </button>
                  <button type="submit" disabled={sending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                    {sending ? 'Envoi…' : 'Envoyer'}
                  </button>
                </div>
              </form>
            </aside>
          )}
        </div>
      </div>
    </Shell>
  );
}
