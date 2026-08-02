// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { Command, Clapperboard, Keyboard, Sparkles, Star } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { usePreferences, useUpdatePreferences } from '../lib/usePreferences';

/**
 * Tour d'onboarding (42.B — №69) : présenté une fois au premier accès (préférence compte
 * `onboardingSeen`). Multi-étapes, ignorable ; réouvrable plus tard depuis « Nouveautés » n'est
 * pas nécessaire — le tour reste léger (pas de spotlight DOM fragile, règle UI simple).
 */
interface Step {
  icon: ReactNode;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: <Sparkles size={20} />,
    title: 'Bienvenue sur ReView',
    body: 'Votre espace de review collaborative : vidéo, image, 3D et splats, avec annotations horodatées, boards et kanban.',
  },
  {
    icon: <Command size={20} />,
    title: 'Tout au clavier',
    body: 'Ctrl+K ouvre la palette de commandes pour naviguer partout. « g » puis p/k/b saute aux projets, kanban ou board.',
  },
  {
    icon: <Clapperboard size={20} />,
    title: 'Reviewer un média',
    body: 'Ouvrez un média pour annoter image par image, comparer des versions (A/B), et laisser des commentaires ancrés à la frame.',
  },
  {
    icon: <Star size={20} />,
    title: 'Personnalisez',
    body: 'Épinglez vos projets en clic droit, enregistrez des vues de liste, et ajustez thème, densité et langue dans votre profil.',
  },
  {
    icon: <Keyboard size={20} />,
    title: 'Besoin d’aide ?',
    body: 'Appuyez sur « ? » pour la liste des raccourcis (reconfigurables), et retrouvez le guide complet dans Documentation.',
  },
];

export default function OnboardingTour() {
  const prefsQ = usePreferences();
  const update = useUpdatePreferences();
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Attendre le chargement des préférences ; ne rien montrer si déjà vu.
  const open = !dismissed && prefsQ.data !== undefined && prefsQ.data.onboardingSeen !== true;

  const finish = () => {
    setDismissed(true);
    update.mutate({ onboardingSeen: true });
  };

  const last = step === STEPS.length - 1;
  const s = STEPS[step]!;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              {s.icon}
            </span>
            {s.title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{s.body}</p>
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-4 bg-primary' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={finish}>
            Passer
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={() => setStep((n) => n - 1)}>
                Précédent
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? finish() : setStep((n) => n + 1))}>
              {last ? 'Commencer' : 'Suivant'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
