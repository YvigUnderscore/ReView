// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { Command, Clapperboard, Keyboard, Sparkles, Star } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { usePreferences, useUpdatePreferences } from '../lib/usePreferences';
import { useT, type MessageKey } from '../i18n';

/**
 * Onboarding tour (42.B, №69): presented once, on first access (account preference
 * `onboardingSeen`). Multi-step, skippable; reopening it later from "What's new" is
 * not necessary: the tour stays light (no fragile DOM spotlight, simple UI rule).
 */
interface Step {
  icon: ReactNode;
  /** Root of the step keys: `<id>.title` and `<id>.body`. */
  id: 'welcome' | 'keyboard' | 'review' | 'personalise' | 'help';
}

const STEPS: Step[] = [
  { icon: <Sparkles size={20} />, id: 'welcome' },
  { icon: <Command size={20} />, id: 'keyboard' },
  { icon: <Clapperboard size={20} />, id: 'review' },
  { icon: <Star size={20} />, id: 'personalise' },
  { icon: <Keyboard size={20} />, id: 'help' },
];

export default function OnboardingTour() {
  const t = useT();
  const prefsQ = usePreferences();
  const update = useUpdatePreferences();
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Wait for the preferences to load; show nothing if already seen.
  const open = !dismissed && prefsQ.data !== undefined && prefsQ.data.onboardingSeen !== true;

  const finish = () => {
    setDismissed(true);
    update.mutate({ onboardingSeen: true });
  };

  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              {s.icon}
            </span>
            {t(`onboarding.${s.id}.title` as MessageKey)}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t(`onboarding.${s.id}.body` as MessageKey)}</p>
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
            {t('common.skip')}
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={() => setStep((n) => n - 1)}>
                {t('common.previous')}
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? finish() : setStep((n) => n + 1))}>
              {last ? t('onboarding.start') : t('common.next')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
