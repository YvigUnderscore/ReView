import { useRef, useState, useEffect } from 'react';

/**
 * Sélecteur de couleur indépendant du navigateur (ne dépend pas de <input type=color>).
 * Compact mais complet : carré Saturation/Valeur, barre de teinte, barre d'alpha,
 * presets et lecture hex. Émet la couleur (#rrggbb) et l'alpha (0..1) séparément.
 */

const PRESETS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#000000'];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export default function ColorPicker({
  color,
  alpha,
  onChange,
}: {
  color: string;
  alpha: number;
  onChange: (color: string, alpha: number) => void;
}) {
  const [h, s, v] = rgbToHsv(...hexToRgb(color));
  const [hue, setHue] = useState(h);
  const svRef = useRef<HTMLDivElement>(null);

  // Resynchronise la teinte si la couleur change de l'extérieur (preset…)
  useEffect(() => {
    setHue(rgbToHsv(...hexToRgb(color))[0]);
  }, [color]);

  const emit = (nh: number, ns: number, nv: number, na = alpha) => {
    const [r, g, b] = hsvToRgb(nh, ns, nv);
    onChange(rgbToHex(r, g, b), na);
  };

  const pickSV = (e: React.PointerEvent) => {
    const r = svRef.current!.getBoundingClientRect();
    const ns = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const nv = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    emit(hue, ns, nv);
  };

  const hueColor = rgbToHex(...hsvToRgb(hue, 1, 1));

  return (
    <div className="w-56 select-none rounded-md border border-border bg-card p-2 shadow-xl">
      {/* Carré saturation / valeur */}
      <div
        ref={svRef}
        className="relative h-32 w-full cursor-crosshair rounded"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pickSV(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pickSV(e);
        }}
      >
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
        />
      </div>

      {/* Teinte */}
      <input
        type="range"
        min={0}
        max={359}
        value={Math.round(hue)}
        onChange={(e) => {
          const nh = Number(e.target.value);
          setHue(nh);
          emit(nh, s, v);
        }}
        className="mt-2 h-3 w-full cursor-pointer appearance-none rounded"
        style={{
          background:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
      />

      {/* Alpha */}
      <div
        className="mt-2 rounded"
        style={{ background: 'repeating-conic-gradient(#666 0% 25%, #999 0% 50%) 50% / 8px 8px' }}
      >
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(alpha * 100)}
          onChange={(e) => onChange(color, Number(e.target.value) / 100)}
          className="h-3 w-full cursor-pointer appearance-none rounded"
          style={{ background: `linear-gradient(to right, transparent, ${color})` }}
        />
      </div>

      {/* Presets + hex */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {PRESETS.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c, alpha)}
            className={`h-5 w-5 rounded-full border ${color.toLowerCase() === c ? 'ring-2 ring-ring' : 'border-border'}`}
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span
          className="inline-block h-4 w-4 rounded border border-border"
          style={{ background: color, opacity: alpha }}
        />
        <span className="font-mono text-muted-foreground">
          {color.toUpperCase()} · α{Math.round(alpha * 100)}%
        </span>
      </div>
    </div>
  );
}
