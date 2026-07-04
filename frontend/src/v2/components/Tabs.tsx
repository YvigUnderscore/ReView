import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export interface TabDef {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
}

/** Barre d'onglets horizontale avec indicateur animé. */
export default function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-5 flex items-center gap-1 border-b border-border">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`relative flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="rounded-full bg-secondary px-1.5 text-xs text-muted-foreground">
                {t.badge}
              </span>
            )}
            {isActive && (
              <motion.div
                layoutId="tab-underline"
                className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                transition={{ duration: 0.2 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
