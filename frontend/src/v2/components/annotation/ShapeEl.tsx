import { arrowHead, textFontSize, type Shape } from './geometry';

/**
 * Rendu SVG d'une forme d'annotation. `size` = dimensions px du canvas (correction
 * d'aspect des éléments dessinés en espace écran : tête de flèche, texte).
 * `highlight` : prévisualisation au survol (outils déplacement/gomme) — halo sous
 * la forme, teinté destructive pour la gomme.
 */
export default function ShapeEl({
  s,
  size,
  highlight,
}: {
  s: Shape;
  size: { w: number; h: number };
  highlight?: 'move' | 'erase' | null;
}) {
  const aspect = size.h > 0 ? size.w / size.h : 1;
  const common = {
    stroke: s.color,
    strokeWidth: s.width,
    strokeOpacity: s.alpha ?? 1,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  // Halo de survol : même géométrie, plus large et semi-transparent, sous la forme.
  const halo = highlight
    ? {
        ...common,
        stroke: highlight === 'erase' ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
        strokeWidth: s.width + 8,
        strokeOpacity: 0.45,
      }
    : null;

  if (s.type === 'path') {
    const points = (s.pts ?? []).map((p) => p.join(',')).join(' ');
    return (
      <>
        {halo && <polyline points={points} {...halo} />}
        <polyline points={points} {...common} />
      </>
    );
  }
  if (s.type === 'rect')
    return (
      <>
        {halo && <rect x={s.x} y={s.y} width={s.w} height={s.h} {...halo} />}
        <rect x={s.x} y={s.y} width={s.w} height={s.h} {...common} />
      </>
    );
  if (s.type === 'ellipse')
    return (
      <>
        {halo && <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...halo} />}
        <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />
      </>
    );
  if (s.type === 'text')
    // Contre-échelle X autour de l'ancre : glyphes non déformés malgré le viewBox étiré.
    return (
      <text
        transform={`translate(${s.x ?? 0} ${s.y ?? 0}) scale(${aspect > 0 ? 1 / aspect : 1} 1)`}
        fill={s.color}
        fillOpacity={s.alpha ?? 1}
        fontSize={textFontSize(s.width)}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        dominantBaseline="middle"
        style={{ userSelect: 'none', paintOrder: 'stroke' }}
        stroke={halo ? halo.stroke : undefined}
        strokeWidth={halo ? 0.006 : undefined}
        strokeOpacity={halo ? 0.6 : undefined}
      >
        {s.text}
      </text>
    );

  // Flèche : fût + tête triangulaire calculée en espace écran (jamais déformée).
  // La tête est remplie ET contourée du même trait à joints ronds : pointes adoucies,
  // taille visuelle cohérente avec l'épaisseur du fût.
  const head = arrowHead(s.x1 ?? 0, s.y1 ?? 0, s.x2 ?? 0, s.y2 ?? 0, size, s.width);
  const shaftEnd: [number, number] = head ? head.shaftEnd : [s.x2 ?? 0, s.y2 ?? 0];
  const headPath = head
    ? `M ${head.tip[0]} ${head.tip[1]} L ${head.left[0]} ${head.left[1]} L ${head.right[0]} ${head.right[1]} Z`
    : null;
  return (
    <>
      {halo && <line x1={s.x1} y1={s.y1} x2={shaftEnd[0]} y2={shaftEnd[1]} {...halo} />}
      <line x1={s.x1} y1={s.y1} x2={shaftEnd[0]} y2={shaftEnd[1]} {...common} />
      {headPath && (
        <path
          d={headPath}
          fill={s.color}
          fillOpacity={s.alpha ?? 1}
          stroke={s.color}
          strokeOpacity={s.alpha ?? 1}
          strokeWidth={s.width}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </>
  );
}
