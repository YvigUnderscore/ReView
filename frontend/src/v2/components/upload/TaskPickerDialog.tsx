// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { FileStack, Layers, Loader2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import PipelineStatusBadge from '../shotgrid/PipelineStatusBadge';
import { toast } from 'sonner';
import { useProjectTasks } from '../../lib/queries';
import { useSgProjectMembers } from '../../lib/shotgridTasksApi';
import { useCreateStepTask, useTaskSteps, type PickableStep } from '../../lib/taskSteps';
import { useT } from '../../i18n';

export interface PickableTask {
  id: number | null;
  name: string;
  department: string | null;
  pipelineStatusId?: number | null;
  versionCount: number;
}

const ROW =
  'flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-secondary/40';

/** Clé d'attente de la tâche sans étape : les autres valent `sg-<id>` ou `dept-<id>`. */
const STEPLESS_KEY = 'stepless';

/**
 * À quelle tâche appartient cette version ?
 *
 * Jusqu'ici la destination était le contexte de navigation : une version créée depuis un
 * asset s'y accrochait directement, sans jamais passer par une tâche. Sur un projet
 * ShotGrid, où un asset traverse cinq étapes (art, model, rig, groom, lookdev) et chaque
 * plan autant, cela range un rendu de texturing à côté de l'asset plutôt que sous l'étape
 * qui l'a produit — et la version poussée vers le site arrive sans `sg_task`.
 *
 * Le dialogue s'ouvre toujours DEPUIS une entité, et ne propose que les tâches de
 * celle-ci. Il a listé un temps le reste du projet — du même bord, asset ou plan — pour
 * ranger un rendu sous n'importe quelle étape sans quitter la page. Fausse commodité :
 * on dépose sur l'entité qu'on regarde, et une version rangée sous un autre asset part
 * vers le site au mauvais endroit, ce qui ne se rattrape pas. Si l'étape manque, on la
 * crée ici même, sur l'entité ouverte.
 *
 * Reste à ne jamais être sans issue : quand l'entité n'a aucune tâche et le pipe aucune
 * étape à proposer, le dialogue explique pourquoi et laisse créer une tâche SANS étape
 * (cf. `barren` / `stepless`). Une boîte vide rendait le dépôt impossible.
 */
export default function TaskPickerDialog({
  open,
  onOpenChange,
  tasks,
  projectId,
  parent,
  allowNone,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tâches de l'entité ouverte, déjà connues de la page. */
  tasks: PickableTask[];
  projectId: number;
  /**
   * L'entité depuis laquelle le dialogue est ouvert : la seule destination possible, et
   * celle qui portera la tâche créée à la volée. Exigée — un dépôt sans entité connue
   * n'existe pas, et le type interdit de faire revenir la liste du projet entier.
   */
  parent: { kind: 'asset' | 'shot'; id: number };
  /**
   * Permettre de rattacher la version au parent plutôt qu'à une tâche.
   *
   * **Réservé à un asset.** Une version pend à une tâche OU à un asset, jamais à un plan :
   * la base l'impose (`CHECK Version_parent_xor`, `num_nonnulls(taskId, assetId) = 1`), et
   * `ShotPage` refuse d'ailleurs un `taskId` nul. Le poser sur un plan par symétrie
   * n'ouvrirait donc qu'un bouton sans effet — sur un plan, la sortie est `stepless`.
   */
  allowNone?: boolean;
  onPick: (taskId: number | null) => void;
}) {
  const t = useT();
  const [creating, setCreating] = useState<string | null>(null);
  // Les tâches du projet ne servent plus de destinations — seulement à proposer des noms
  // déjà employés. Demandées à l'ouverture seulement : sur un gros projet, ce n'est pas
  // une liste à charger à chaque affichage de page.
  const { data: projectTasks = [] } = useProjectTasks(projectId, open);
  // Les étapes du pipe, d'où qu'elles viennent : le site sur un projet relié — elles y
  // existent avant toute tâche, et c'est ce qui manquait pour déposer un rendu sur un asset
  // neuf — les départements du projet sinon (B2).
  const { linked, steps, isLoading } = useTaskSteps(projectId, parent.kind, open);
  const { data: members = [] } = useSgProjectMembers(projectId, open && linked);
  const createTask = useCreateStepTask(projectId);
  // Nom et personne à qui confier la tâche : proposés, jamais imposés. Le nom part du
  // code de l'étape — c'est la convention — mais un studio nomme parfois « model_hi »
  // là où l'étape s'appelle « modeling ».
  const [draftName, setDraftName] = useState('');
  const [assignee, setAssignee] = useState('');

  const choose = (taskId: number | null) => {
    onOpenChange(false);
    onPick(taskId);
  };

  /**
   * Étapes qu'aucune tâche de l'entité ne couvre encore.
   *
   * Toutes déroulées, sans recherche : la liste est celle du projet — celles que le
   * studio a déclarées, ou à défaut celles que ses tasks emploient — et elle tient à
   * l'écran. Chercher dans cinq lignes n'aide personne.
   */
  const freeSteps = useMemo(() => {
    const covered = new Set(tasks.map((task) => (task.department ?? task.name).toLowerCase()));
    return steps.filter((step) => !covered.has(step.code.toLowerCase()));
  }, [steps, tasks]);

  /**
   * Rien à choisir et rien à créer : le dialogue serait une boîte vide, et le dépôt
   * impossible.
   *
   * Le cas est atteignable, et pas seulement en configuration exotique : rien ne sème de
   * département à l'installation, donc un studio qui n'en a jamais déclaré n'en a AUCUN ;
   * la politique de département ne laisse d'étape écrivable qu'à qui appartient à l'une
   * d'elles ; un site relié peut ne rien exposer pour ce type d'entité. Sur une entité
   * neuve il ne restait alors que la croix de la modale, et le média restait sur le bureau.
   * La liste du projet entier servait de sortie de secours — elle déposait au mauvais
   * endroit, ce qui ne se rattrape pas.
   */
  const barren = !isLoading && tasks.length === 0 && freeSteps.length === 0;
  /**
   * La vraie sortie : une tâche SANS étape, sur l'entité ouverte. Le serveur l'accepte de
   * tout contributeur — la politique de département ne se vérifie que lorsqu'une étape est
   * renseignée (`TaskService.create`) — et elle range la version au bon endroit.
   *
   * Jamais sur un projet relié : une tâche née dans ReView y ferait doublon à la
   * synchronisation suivante. Là, c'est au site de déclarer l'étape ; le dialogue le dit.
   */
  const stepless = barren && !linked;
  // Sans étape, le nom ne peut plus retomber sur son code : il devient obligatoire, et le
  // libellé du champ doit cesser de promettre un défaut qui n'existe pas.
  const namePrompt = stepless ? t('upload.pickTask.nameRequired') : t('upload.pickTask.namePlaceholder');

  const createFromStep = async (step: PickableStep | null) => {
    setCreating(step?.key ?? STEPLESS_KEY);
    try {
      // La tâche naît dans ShotGrid ou dans ReView selon l'étape choisie — `useCreateStepTask`
      // tranche, le dialogue n'a pas à connaître les deux chemins.
      const created = await createTask({
        step,
        parent,
        name: draftName,
        assigneeSgId: assignee ? Number(assignee) : null,
      });
      // Le message ne promet ShotGrid que lorsque la tâche y a bien été créée : sur un
      // projet autonome, annoncer une écriture distante serait faux.
      toast.success(
        step?.sgId !== undefined
          ? t('upload.pickTask.created', { name: created.name })
          : t('task.createdNamed', { name: created.name }),
      );
      choose(created.taskId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('upload.pickTask.createFailed'));
    } finally {
      setCreating(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('upload.pickTask.title')}</DialogTitle>
        </DialogHeader>
        {/* L'aide parlait de ShotGrid à tout le monde, y compris sur un projet autonome. */}
        <p className="text-sm text-muted-foreground">
          {linked ? t('upload.pickTask.hint') : t('upload.pickTask.hintLocal')}
        </p>

        <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
          {tasks.map((task) => (
            <button key={task.id ?? 'none'} type="button" onClick={() => choose(task.id)} className={ROW}>
              <FileStack size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="truncate font-medium">{task.name}</span>
                {/* Le département ne s'affiche que s'il apprend quelque chose : sur un
                    site ShotGrid, le nom de la tâche EST souvent celui de l'étape. */}
                {task.department && task.department !== task.name && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    <Layers size={10} className="mr-0.5 inline" />
                    {task.department}
                  </span>
                )}
              </span>
              <PipelineStatusBadge statusId={task.pipelineStatusId} scope="task" size="xs" />
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('asset.tree.versionCount', { count: task.versionCount })}
              </span>
            </button>
          ))}

          {/* Le pipe se charge : dire « rien à choisir » avant sa réponse serait faux. */}
          {isLoading && <p className="px-1 py-2 text-sm text-muted-foreground">{t('common.loading')}</p>}

          {/* La boîte vide s'explique, et dit ce qui reste à faire pour déposer quand même. */}
          {barren && (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              {stepless ? t('upload.pickTask.barren') : t('upload.pickTask.barrenLinked')}
            </p>
          )}

          {(freeSteps.length > 0 || stepless) && (
            <>
              <p className="pt-2 text-xs font-semibold section-label text-muted-foreground">
                {t('upload.pickTask.steps')}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  list="review-task-names"
                  placeholder={namePrompt}
                  aria-label={namePrompt}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
                {/* Les noms déjà employés — ici et ailleurs dans le projet. Un nom n'est
                    pas une destination : la convention du studio se lit sur tout le
                    projet (« model_hi » là où l'étape s'appelle « modeling »), alors que
                    la version, elle, ne peut se ranger que sous l'entité ouverte. */}
                <datalist id="review-task-names">
                  {[...new Set([...tasks.map((x) => x.name), ...projectTasks.map((x) => x.name)])].map(
                    (n) => (
                      <option key={n} value={n} />
                    ),
                  )}
                </datalist>
                <select
                  aria-label={t('task.new.assignee')}
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  disabled={members.length === 0}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                >
                  <option value="">{t('upload.pickTask.noAssignee')}</option>
                  {members.map((m) => (
                    <option key={m.sgId} value={m.sgId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {freeSteps.map((step) => (
            <button
              key={step.key}
              type="button"
              disabled={creating !== null}
              onClick={() => void createFromStep(step)}
              className={`${ROW} disabled:opacity-50`}
            >
              {creating === step.key ? (
                <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Plus size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {/* Le libellé ne promet ShotGrid que lorsque la tâche y sera bien créée. */}
                {step.sgId !== undefined
                  ? t('upload.pickTask.createStep', { step: step.code })
                  : t('upload.pickTask.createStepLocal', { step: step.code })}
              </span>
              {step.color && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: step.color }} />
              )}
            </button>
          ))}

          {stepless && (
            <button
              type="button"
              // Sans étape d'où tirer le nom, un nom vide ferait une tâche que le serveur
              // refuse : le bouton attend qu'on en donne un.
              disabled={creating !== null || draftName.trim() === ''}
              onClick={() => void createFromStep(null)}
              className={`${ROW} disabled:opacity-50`}
            >
              {creating === STEPLESS_KEY ? (
                <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Plus size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{t('upload.pickTask.createStepless')}</span>
            </button>
          )}

          {allowNone && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="w-full rounded-md border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary/60"
            >
              {t('upload.pickTask.none')}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
