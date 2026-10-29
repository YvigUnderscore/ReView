// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../../lib/apiClient';
import ProjectBurninSection from './ProjectBurninSection';
import ProjectStorageSection from './ProjectStorageSection';
import ProjectNamingSection from './ProjectNamingSection';
import ProjectReviewRequestSection from './ProjectReviewRequestSection';
import ProjectDefaultLightingSection from './ProjectDefaultLightingSection';
import ProjectColorSection from './ProjectColorSection';
import ProjectSettingsInheritance from './ProjectSettingsInheritance';
import ProjectStartFrameSection from './ProjectStartFrameSection';
import ProjectFormatSection from './ProjectFormatSection';
import ProjectNomenclatureSection from './ProjectNomenclatureSection';
import ProjectDepartmentsSection from './ProjectDepartmentsSection';
import { buildSettingsPatch } from '../lib/projectInheritance';
import type { ProjectSettings } from '../types/api';
import { useT } from '../i18n';
import { Button } from './ui/button';
import { Hint } from './ui/hint';
import { SettingsSearchBar, SettingsSearchEmpty, SettingsSearchProvider } from './settings/SettingsSearch';
import SgProjectSection from './shotgrid/SgProjectSection';
import EpisodesToggle from '../pages/project/EpisodesToggle';

/**
 * "Settings" tab of a project (admin/supervisor): the composition of the sections, and
 * the save they share: studio inheritance, start frame, format and frame rate,
 * nomenclature, departments, then the review, color and distribution rules.
 *
 * Each section is autonomous: it receives its value and renders the new one, without knowing
 * how it gets saved. This file therefore keeps only one save gesture.
 *
 * The screen handles the EFFECTIVE settings. Re-saving them in bulk would freeze into the project
 * everything it merely inherited: so we only send the sections actually
 * modified, as a PATCH (`buildSettingsPatch`).
 *
 * **No undo/redo here, and this is a choice.** The form is a DRAFT: nothing goes out before
 * "Save", and `baseline` keeps the reference state. Until one has saved, abandoning it means
 * leaving the tab; each text field already has the browser's Ctrl+Z, which does the job better
 * in an input. A form-level Ctrl+Z would have to choose what it undoes
 * (the keystroke, the field, the section, the whole draft), and every answer is wrong for
 * half the cases. After saving, the reverse is not invented either: handing a section
 * back to the studio is an explicit gesture, and it already exists (`ProjectSettingsInheritance`).
 */
export default function ProjectSettingsTab({
  projectId,
  startFrame,
  onStartFrameChange,
  settings,
  onSettingsChange,
}: {
  projectId: number;
  startFrame: number;
  onStartFrameChange: (n: number) => void;
  settings: ProjectSettings | null;
  onSettingsChange: (s: ProjectSettings) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<ProjectSettings | null>(settings);
  // Starting point of the draft: it is what says what the person actually touched.
  const [baseline, setBaseline] = useState<ProjectSettings | null>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Syncs the local draft when the settings arrive (asynchronously)
  if (settings && !draft) {
    setDraft(settings);
    setBaseline(settings);
  }

  const saveSettings = async () => {
    if (!draft || !baseline) return;
    const patch = buildSettingsPatch(baseline, draft);
    setError(null);
    if (Object.keys(patch).length === 0) {
      setMsg(t('project.settingsUnchanged'));
      return;
    }
    setSavingSettings(true);
    setMsg(null);
    try {
      const { settings: saved } = await api.patch<{ settings: ProjectSettings }>(
        `/api/projects/${projectId}/settings`,
        patch,
      );
      onSettingsChange(saved);
      setDraft(saved);
      setBaseline(saved);
      setMsg(t('project.settingsSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setSavingSettings(false);
    }
  };

  /** A section handed back to the studio changes the effective settings: the draft restarts from there. */
  const applyReverted = (fresh: ProjectSettings) => {
    setDraft(fresh);
    setBaseline(fresh);
    setError(null);
    setMsg(null);
    onSettingsChange(fresh);
  };

  return (
    <SettingsSearchProvider>
      <div className="max-w-2xl space-y-4">
        {/* La recherche : même barre que dans les réglages du studio et ceux du profil.
            Quinze cartes en colonne se parcouraient à l'œil — « où règle-t-on le
            filigrane » n'avait pas d'autre réponse que de descendre la page. */}
        <SettingsSearchBar />
        {error && <Hint tone="error">{error}</Hint>}
        {msg && <Hint tone="success">{msg}</Hint>}

        {/* Héritage studio : ce qui descend du studio, ce que le projet s'est approprié. */}
        <ProjectSettingsInheritance projectId={projectId} onReverted={applyReverted} />

        {/* Frame de départ : champ du projet, elle s'enregistre seule. */}
        <ProjectStartFrameSection
          projectId={projectId}
          startFrame={startFrame}
          onStartFrameChange={onStartFrameChange}
        />

        {/* Format & cadence (résolution + fps) — défauts du projet, hérités par séquences/shots */}
        <ProjectFormatSection
          value={draft}
          onChange={(pipeline) => setDraft((d) => d && { ...d, ...pipeline })}
        />

        {/* Nomenclature : override des défauts studio. */}
        <ProjectNomenclatureSection
          value={draft?.nomenclature ?? null}
          onChange={(nomenclature) => setDraft((d) => d && { ...d, nomenclature })}
        />

        {/* Niveau Épisode (série) : l'interrupteur vit ici, c'est le seul endroit d'où
            il s'allume — l'onglet Épisodes n'existe pas tant qu'il est éteint. */}
        <EpisodesToggle projectId={projectId} />

        {/* Départements (B1) : clés et noms dans le brouillon, images enregistrées à part. */}
        <ProjectDepartmentsSection
          projectId={projectId}
          value={draft?.departments ?? null}
          onChange={(departments) => setDraft((d) => d && { ...d, departments })}
        />

        {/* Convention de nommage (38.C) : éditée dans le draft, enregistrée avec les réglages. */}
        {draft && (
          <ProjectNamingSection
            value={draft.naming ?? { pattern: '', mode: 'off' }}
            onChange={(naming) => setDraft((d) => d && { ...d, naming })}
          />
        )}

        {/* Consigne exigée d'un ReViewer tagué : le geste se fait à l'upload, la règle se pose ici. */}
        {draft && (
          <ProjectReviewRequestSection
            value={draft.reviewRequest ?? { requireNote: false, minNoteLength: 5 }}
            onChange={(reviewRequest) => setDraft((d) => d && { ...d, reviewRequest })}
          />
        )}

        {/* Éclairage 3D par défaut (39.F) : HDRI hérité par les médias 3D, enregistré avec les réglages. */}
        {draft && (
          <ProjectDefaultLightingSection
            value={draft.defaultLighting}
            onChange={(defaultLighting) => setDraft((d) => d && { ...d, defaultLighting })}
          />
        )}

        {/* Gestion de couleur OCIO (39.B) : config + display/view, enregistré avec les réglages. */}
        {draft && (
          <ProjectColorSection
            value={draft.color}
            onChange={(color) => setDraft((d) => d && { ...d, color })}
          />
        )}

        {/* Stockage (38.D) : usage + quota du projet. */}
        <ProjectStorageSection projectId={projectId} />

        {/* Burn-ins (35.A) : override du template studio, enregistré avec les réglages. */}
        {draft && (
          <ProjectBurninSection
            value={draft.burnin}
            onChange={(burnin) => setDraft((d) => d && { ...d, burnin })}
          />
        )}

        {/* Liaison ShotGrid (48) : le point d'entrée vit ici, pas dans un onglet
            permanent qu'un studio sans ShotGrid n'a aucune raison de voir. */}
        <SgProjectSection projectId={projectId} canManage />

        <SettingsSearchEmpty />

        {/* Un seul geste d'enregistrement pour tout le brouillon. Les sections qui
            s'enregistrent seules (frame de départ, quota, images de département) le disent
            dans leur propre carte : elles ne passent pas par ce bouton. */}
        <Button onClick={() => void saveSettings()} disabled={savingSettings || !draft}>
          <Save size={15} className="mr-1.5" />
          {savingSettings ? t('common.saving') : t('project.saveSettings')}
        </Button>
      </div>
    </SettingsSearchProvider>
  );
}
