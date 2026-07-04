/** Graphique en barres minimaliste (SVG), sans dépendance externe. */
export default function MiniBarChart({
  data,
  height = 120,
  color = 'var(--primary, #6366f1)',
  valueFormat,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  valueFormat?: (v: number) => string;
}) {
  if (data.length === 0) return <p className="text-xs text-muted-foreground">Aucune donnée.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = 100 / data.length;

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 16);
          return (
            <g key={i}>
              <rect
                x={i * barW + barW * 0.15}
                y={height - h - 14}
                width={barW * 0.7}
                height={Math.max(h, d.value > 0 ? 1 : 0)}
                rx={0.6}
                fill={color}
                opacity={0.85}
              >
                <title>{`${d.label}: ${valueFormat ? valueFormat(d.value) : d.value}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
