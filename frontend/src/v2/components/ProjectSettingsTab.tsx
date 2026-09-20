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
import SgProjectSection from './shotgrid/SgProjectSection';
import EpisodesToggle from '../pages/project/EpisodesToggle';

/**
 * Onglet « Réglages » d'un projet (admin/superviseur) : la composition des sections, et
 * l'enregistrement qu'elles partagent — héritage studio, frame de départ, format & cadence,
 * nomenclature, départements, puis les règles de review, de couleur et de diffusion.
 *
 * Chaque section est autonome : elle reçoit sa valeur et rend la nouvelle, sans savoir
 * comment on l'enregistre. Ce fichier ne garde donc qu'un seul geste d'enregistrement.
 *
 * L'écran manipule les réglages EFFECTIFS. Les réenregistrer en bloc figeait dans le projet
 * tout ce qu'il ne faisait qu'hériter : on n'envoie donc que les sections réellement
 * modifiées, en PATCH (`buildSettingsPatch`).
 *
 * **Pas d'undo/redo ici, et c'est un choix.** Le formulaire est un BROUILLON : rien ne part avant
 * « Enregistrer », et `baseline` garde l'état de référence. Tant qu'on n'a pas enregistré,
 * abandonner c'est quitter l'onglet ; chaque champ de texte a déjà le Ctrl+Z du navigateur, qui
 * fait mieux le travail dans une saisie. Un Ctrl+Z de formulaire devrait choisir ce qu'il défait
 * — la frappe, le champ, la section, le brouillon entier — et chaque réponse est fausse pour la
 * moitié des cas. Après enregistrement, l'inverse ne s'invente pas non plus : rendre une section
 * au studio est un geste explicite, et il existe déjà (`ProjectSettingsInheritance`).
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
  // Point de départ du brouillon : c'est lui qui dit ce que la personne a réellement touché.
  const [baseline, setBaseline] = useState<ProjectSettings | null>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Synchronise le brouillon local quand les settings arrivent (asynchrones)
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

  /** Une section rendue au studio change les effectifs : le brouillon repart de là. */
  const applyReverted = (fresh: ProjectSettings) => {
    setDraft(fresh);
    setBaseline(fresh);
    setError(null);
    setMsg(null);
    onSettingsChange(fresh);
  };

  return (
    <div className="max-w-2xl space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {msg && <p className="text-sm text-success">{msg}</p>}

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

      <button
        onClick={saveSettings}
        disabled={savingSettings || !draft}
        className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        <Save size={15} /> {savingSettings ? t('common.saving') : t('project.saveSettings')}
      </button>
    </div>
  );
}
