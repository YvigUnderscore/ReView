// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ComponentType } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Search,
  Bot,
  Box,
  CalendarClock,
  ClipboardCheck,
  Database,
  Eye,
  Film,
  Fingerprint,
  FolderKanban,
  KeyRound,
  ListChecks,
  Workflow,
  FolderCog,
  LayoutDashboard,
  LogIn,
  Mail,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Radio,
  Palette,
  Server,
  Share2,
  Video,
  Settings as SettingsIcon,
  EyeOff,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import { useAuth } from '../stores/useAuth';
import PageShell from '../components/PageShell';
import OverviewTab from './admin/OverviewTab';
import ActivityTab from './admin/ActivityTab';
import SystemTab from './admin/SystemTab';
import UsersTab from './admin/UsersTab';
import UserDetailTab from './admin/UserDetailTab';
import ProjectsAdminTab from './admin/ProjectsAdminTab';
import ProjectAdminDetailTab from './admin/ProjectAdminDetailTab';
import VersionsTab from './admin/VersionsTab';
import VisibilityTab from './admin/VisibilityTab';
import CommentsTab from './admin/CommentsTab';
import StorageTab from './admin/StorageTab';
import SettingsTab from './admin/SettingsTab';
import ProjectDefaultsTab from './admin/ProjectDefaultsTab';
import HdriTab from './admin/HdriTab';
import OcioTab from './admin/OcioTab';
import TranscodeTab from './admin/TranscodeTab';
import DistributionTab from './admin/DistributionTab';
import ApiWebhooksTab from './admin/ApiWebhooksTab';
import ServiceTokensTab from './admin/ServiceTokensTab';
import MediaAccessTab from './admin/MediaAccessTab';
import IdentityTab from './admin/IdentityTab';
import LoginAppearanceTab from './admin/LoginAppearanceTab';
import JobsTab from './admin/JobsTab';
import ReviewStatusTab from './admin/ReviewStatusTab';
import AnnouncementsTab from './admin/AnnouncementsTab';
import SmtpTab from './admin/SmtpTab';
import TrashTab from './admin/TrashTab';
import RetentionTab from './admin/RetentionTab';
import { useT } from '../i18n';
import ShotgridSitesTab from './admin/ShotgridSitesTab';
import LiveRoomTab from './admin/LiveRoomTab';
import ChatTab from './admin/ChatTab';
import { sectionHaystack, sectionMatches } from './admin/settingsSearch';
import { ADMIN_GROUPS, adminGroupLabel, adminSections, type AdminSectionKey } from './admin/adminSections';

/**
 * Écran de chaque section d'administration : l'icône de la barre latérale, l'onglet, et la
 * vue de détail quand l'URL porte un id (/admin/users/12, /admin/projects/3).
 *
 * Les clés, les groupes et les libellés vivent dans `admin/adminSections` : la palette
 * Ctrl+K les lit aussi, et une seconde table divergerait au premier renommage. Le type de
 * clé rend l'oubli impossible — ajouter une section sans lui donner d'écran ne compile pas.
 */
const VIEWS: Record<AdminSectionKey, { icon: LucideIcon; Component: ComponentType; Detail?: ComponentType }> =
  {
    overview: { icon: LayoutDashboard, Component: OverviewTab },
    activity: { icon: Activity, Component: ActivityTab },
    identity: { icon: Fingerprint, Component: IdentityTab },
    'login-appearance': { icon: LogIn, Component: LoginAppearanceTab },
    system: { icon: Server, Component: SystemTab },
    settings: { icon: SettingsIcon, Component: SettingsTab },
    defaults: { icon: FolderCog, Component: ProjectDefaultsTab },
    users: { icon: UsersIcon, Component: UsersTab, Detail: UserDetailTab },
    projects: { icon: FolderKanban, Component: ProjectsAdminTab, Detail: ProjectAdminDetailTab },
    versions: { icon: Film, Component: VersionsTab },
    comments: { icon: MessageSquare, Component: CommentsTab },
    storage: { icon: Database, Component: StorageTab },
    visibility: { icon: EyeOff, Component: VisibilityTab },
    hdri: { icon: Box, Component: HdriTab },
    ocio: { icon: Palette, Component: OcioTab },
    video: { icon: Video, Component: TranscodeTab },
    distribution: { icon: Share2, Component: DistributionTab },
    'review-statuses': { icon: ClipboardCheck, Component: ReviewStatusTab },
    live: { icon: Radio, Component: LiveRoomTab },
    announcements: { icon: Megaphone, Component: AnnouncementsTab },
    smtp: { icon: Mail, Component: SmtpTab },
    api: { icon: KeyRound, Component: ApiWebhooksTab },
    'service-tokens': { icon: Bot, Component: ServiceTokensTab },
    shotgrid: { icon: Workflow, Component: ShotgridSitesTab },
    chat: { icon: MessagesSquare, Component: ChatTab },
    jobs: { icon: ListChecks, Component: JobsTab },
    trash: { icon: Trash2, Component: TrashTab },
    retention: { icon: CalendarClock, Component: RetentionTab },
    'media-access': { icon: Eye, Component: MediaAccessTab },
  };

export default function AdminPage() {
  const t = useT();
  const role = useAuth((s) => s.user?.role);
  const { section, id } = useParams();
  const [query, setQuery] = useState('');
  if (role !== 'ADMIN') {
    return (
      <PageShell title={t('nav.settings')}>
        <p className="text-sm text-destructive">{t('admin.restricted')}</p>
      </PageShell>
    );
  }
  /*
   * `/admin/audit` a disparu : il rendait `/api/studio/audit`, exactement comme « Activité »,
   * mais sans pagination, sans auteur et sans lien vers les entités — deux sections
   * concurrentes pour le même journal, dans deux groupes différents, et l'administrateur
   * qui cherchait « qui a changé ce réglage » trouvait la mauvaise selon le groupe ouvert.
   * L'adresse continue de fonctionner : les liens et signets existants aboutissent.
   */
  const all = adminSections(t);
  const visibleSections = all.filter((s) => sectionMatches(sectionHaystack(s.key, s.label, t), query));

  const resolved = section === 'audit' ? 'activity' : section;
  const active = all.find((s) => s.key === resolved) ?? all[0];
  const view = VIEWS[active.key];
  const Active = id && view.Detail ? view.Detail : view.Component;

  return (
    <PageShell>
      {/* Un seul nom pour un seul endroit : le lien de la barre latérale, la palette et
          ce titre disent tous « Réglages ». La page s'appelait « Administration », son
          lien « Paramètres » et l'une de ses sections « Réglages » — trois mots pour le
          même écran, dont deux qu'on ne retrouvait nulle part ailleurs. */}
      <h1 className="mb-4 text-xl font-semibold">{t('nav.settings')}</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible md:pb-0">
          {/* Chercher dans les réglages, pas seulement dans leurs titres : vingt-huit
              sections en cinq groupes sont introuvables sans cela — on cherche
              « watermark », pas « Diffusion ». */}
          <div className="relative mb-2 hidden md:block">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.search.placeholder')}
              aria-label={t('admin.search.placeholder')}
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {ADMIN_GROUPS.map((group) => {
            const inGroup = visibleSections.filter((s) => s.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="flex gap-1 md:flex-col">
                <div className="hidden px-3 pb-1 pt-3 text-2xs font-semibold section-label tracking-wider text-muted-foreground/70 first:pt-0 md:block">
                  {adminGroupLabel(t, group)}
                </div>
                {inGroup.map((s) => {
                  const Icon = VIEWS[s.key].icon;
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
            );
          })}
          {visibleSections.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('admin.search.empty')}</p>
          )}
        </nav>
        <div className="min-w-0 flex-1">
          <Active />
        </div>
      </div>
    </PageShell>
  );
}
