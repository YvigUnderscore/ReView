// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ComponentType } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Bot,
  Box,
  CalendarClock,
  ClipboardCheck,
  Database,
  DownloadCloud,
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
import UpdatesTab from './admin/UpdatesTab';
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
import { SettingsSearchBar } from '../components/settings/SettingsSearch';
import { ADMIN_GROUPS, adminGroupLabel, adminSections, type AdminSectionKey } from './admin/adminSections';

/**
 * Screen for each administration section: the sidebar icon, the tab, and the
 * detail view when the URL carries an id (/admin/users/12, /admin/projects/3).
 *
 * Keys, groups and labels live in `admin/adminSections`: the Ctrl+K palette
 * reads them too, and a second table would diverge at the first rename. The key type
 * makes forgetting impossible — adding a section without giving it a screen does not compile.
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
    updates: { icon: DownloadCloud, Component: UpdatesTab },
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
   * `/admin/audit` has gone: it rendered `/api/studio/audit`, exactly like "Activity",
   * but without pagination, without author and without links to the entities — two
   * competing sections for the same log, in two different groups, and the administrator
   * looking for "who changed this setting" found a different one depending on the group open.
   * The address still works: existing links and bookmarks resolve.
   */
  const all = adminSections(t);
  const visibleSections = all.filter((s) => sectionMatches(sectionHaystack(s.key, s.label, t), query));

  const resolved = section === 'audit' ? 'activity' : section;
  const active = all.find((s) => s.key === resolved) ?? all[0];
  const view = VIEWS[active.key];
  const Active = id && view.Detail ? view.Detail : view.Component;

  return (
    <PageShell>
      {/* One name for one place: the sidebar link, the palette and
          this title all say "Settings". The page was called "Administration", its
          link "Parameters" and one of its sections "Settings" — three words for the
          same screen, two of which were found nowhere else. */}
      <h1 className="mb-4 text-xl font-semibold">{t('nav.settings')}</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible md:pb-0">
          {/* Search the settings, not only their titles: twenty-eight
              sections in five groups are unfindable without this — one searches for
              "watermark", not "Distribution". */}
          <SettingsSearchBar value={query} onChange={setQuery} className="mb-2 hidden md:block" />
          {ADMIN_GROUPS.map((group) => {
            const inGroup = visibleSections.filter((s) => s.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="flex gap-1 md:flex-col">
                <div className="hidden px-3 pb-1 pt-3 text-2xs font-semibold section-label tracking-wider text-muted-foreground first:pt-0 md:block">
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
