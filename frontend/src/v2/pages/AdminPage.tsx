// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  Box,
  ClipboardCheck,
  Database,
  Eye,
  Film,
  Fingerprint,
  FolderKanban,
  KeyRound,
  ListChecks,
  FolderCog,
  History,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageSquare,
  Palette,
  Server,
  Share2,
  Video,
  Settings as SettingsIcon,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import { useAuth } from '../stores/useAuth';
import Shell from '../components/Shell';
import OverviewTab from './admin/OverviewTab';
import ActivityTab from './admin/ActivityTab';
import SystemTab from './admin/SystemTab';
import UsersTab from './admin/UsersTab';
import UserDetailTab from './admin/UserDetailTab';
import ProjectsAdminTab from './admin/ProjectsAdminTab';
import ProjectAdminDetailTab from './admin/ProjectAdminDetailTab';
import VersionsTab from './admin/VersionsTab';
import CommentsTab from './admin/CommentsTab';
import StorageTab from './admin/StorageTab';
import SettingsTab from './admin/SettingsTab';
import ProjectDefaultsTab from './admin/ProjectDefaultsTab';
import HdriTab from './admin/HdriTab';
import OcioTab from './admin/OcioTab';
import TranscodeTab from './admin/TranscodeTab';
import DistributionTab from './admin/DistributionTab';
import ApiWebhooksTab from './admin/ApiWebhooksTab';
import MediaAccessTab from './admin/MediaAccessTab';
import IdentityTab from './admin/IdentityTab';
import JobsTab from './admin/JobsTab';
import ReviewStatusTab from './admin/ReviewStatusTab';
import AnnouncementsTab from './admin/AnnouncementsTab';
import SmtpTab from './admin/SmtpTab';
import TrashTab from './admin/TrashTab';
import AuditTab from './admin/AuditTab';
import { useT, type MessageKey } from '../i18n';

/** Traducteur passé aux tables de libellés, recalculées à chaque rendu. */
type Tr = (key: MessageKey) => string;

/**
 * Sections d'administration — sous-routées via /admin/:section (10.C6), regroupées par
 * domaine. Refonte admin : le groupe « Contenus » offre des pages détaillées par entité
 * (utilisateurs, projets, versions, commentaires, stockage) ; une section peut définir un
 * composant `Detail` rendu quand l'URL porte un id (/admin/users/12, /admin/projects/3).
 */
const sections = (t: Tr) =>
  [
    {
      key: 'overview',
      group: 'studio',
      label: t('admin.tab.dashboard'),
      icon: LayoutDashboard,
      Component: OverviewTab,
    },
    {
      key: 'activity',
      group: 'studio',
      label: t('admin.tab.activity'),
      icon: Activity,
      Component: ActivityTab,
    },
    {
      key: 'identity',
      group: 'studio',
      label: t('admin.tab.identity'),
      icon: Fingerprint,
      Component: IdentityTab,
    },
    {
      key: 'system',
      group: 'studio',
      label: t('admin.tab.system'),
      icon: Server,
      Component: SystemTab,
    },
    {
      key: 'settings',
      group: 'studio',
      label: t('admin.tab.settings'),
      icon: SettingsIcon,
      Component: SettingsTab,
    },
    {
      key: 'defaults',
      group: 'studio',
      label: t('admin.tab.projectDefaults'),
      icon: FolderCog,
      Component: ProjectDefaultsTab,
    },
    {
      key: 'users',
      group: 'content',
      label: t('admin.tab.users'),
      icon: UsersIcon,
      Component: UsersTab,
      Detail: UserDetailTab,
    },
    {
      key: 'projects',
      group: 'content',
      label: t('nav.projects'),
      icon: FolderKanban,
      Component: ProjectsAdminTab,
      Detail: ProjectAdminDetailTab,
    },
    { key: 'versions', group: 'content', label: 'Versions', icon: Film, Component: VersionsTab },
    {
      key: 'comments',
      group: 'content',
      label: t('admin.tab.comments'),
      icon: MessageSquare,
      Component: CommentsTab,
    },
    { key: 'storage', group: 'content', label: t('storage.title'), icon: Database, Component: StorageTab },
    { key: 'hdri', group: 'reviewContexts', label: '3D & Splat', icon: Box, Component: HdriTab },
    { key: 'ocio', group: 'reviewContexts', label: t('admin.tab.color'), icon: Palette, Component: OcioTab },
    {
      key: 'video',
      group: 'reviewContexts',
      label: t('admin.tab.video'),
      icon: Video,
      Component: TranscodeTab,
    },
    {
      key: 'distribution',
      group: 'reviewContexts',
      label: t('review.delivery'),
      icon: Share2,
      Component: DistributionTab,
    },
    {
      key: 'review-statuses',
      group: 'reviewContexts',
      label: t('admin.tab.statuses'),
      icon: ClipboardCheck,
      Component: ReviewStatusTab,
    },
    {
      key: 'announcements',
      group: 'communications',
      label: t('admin.tab.announcements'),
      icon: Megaphone,
      Component: AnnouncementsTab,
    },
    { key: 'smtp', group: 'communications', label: 'SMTP', icon: Mail, Component: SmtpTab },
    {
      key: 'api',
      group: 'communications',
      label: 'API & Webhooks',
      icon: KeyRound,
      Component: ApiWebhooksTab,
    },
    { key: 'jobs', group: 'maintenance', label: 'Jobs', icon: ListChecks, Component: JobsTab },
    { key: 'trash', group: 'maintenance', label: t('admin.tab.trash'), icon: Trash2, Component: TrashTab },
    { key: 'audit', group: 'maintenance', label: 'Audit', icon: History, Component: AuditTab },
    {
      key: 'media-access',
      group: 'maintenance',
      label: t('admin.tab.mediaAccess'),
      icon: Eye,
      Component: MediaAccessTab,
    },
  ] as const;

/** Groupes de la barre latérale : clé stable + libellé traduit au rendu. */
const GROUPS = ['studio', 'content', 'reviewContexts', 'communications', 'maintenance'] as const;
const groupLabel = (t: Tr, g: (typeof GROUPS)[number]) => t(`admin.group.${g}` as MessageKey);

export default function AdminPage() {
  const t = useT();
  const role = useAuth((s) => s.user?.role);
  const { section, id } = useParams();
  if (role !== 'ADMIN') {
    return (
      <Shell title="Administration">
        <p className="text-sm text-destructive">{t('admin.restricted')}</p>
      </Shell>
    );
  }
  const active = sections(t).find((s) => s.key === section) ?? sections(t)[0];
  const Detail = 'Detail' in active ? active.Detail : undefined;
  const Active = id && Detail ? Detail : active.Component;

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">Administration</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible md:pb-0">
          {GROUPS.map((group) => (
            <div key={group} className="flex gap-1 md:flex-col">
              <div className="hidden px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-0 md:block">
                {groupLabel(t, group)}
              </div>
              {sections(t)
                .filter((s) => s.group === group)
                .map((s) => {
                  const Icon = s.icon;
                  const on = s.key === active.key;
                  return (
                    <Link
                      key={s.key}
                      to={`/admin/${s.key}`}
                      className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                        on
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                      }`}
                    >
                      <Icon size={16} /> {s.label}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Active />
        </div>
      </div>
    </Shell>
  );
}
