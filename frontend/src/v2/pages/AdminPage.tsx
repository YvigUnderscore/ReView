import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  Box,
  ClipboardCheck,
  Eye,
  Fingerprint,
  KeyRound,
  ListChecks,
  FolderCog,
  History,
  LayoutDashboard,
  Mail,
  Megaphone,
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
import SettingsTab from './admin/SettingsTab';
import ProjectDefaultsTab from './admin/ProjectDefaultsTab';
import HdriTab from './admin/HdriTab';
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

/**
 * Sections d'administration — sous-routées via /admin/:section (10.C6), regroupées par
 * domaine (Phase 22) : les **contextes** de review (3D & Splat = HDRI/éclairage, Vidéo =
 * transcodage) sont isolés des réglages généraux et des communications.
 */
const SECTIONS = [
  {
    key: 'overview',
    group: 'Studio',
    label: 'Tableau de bord',
    icon: LayoutDashboard,
    Component: OverviewTab,
  },
  { key: 'activity', group: 'Studio', label: 'Activité', icon: Activity, Component: ActivityTab },
  { key: 'users', group: 'Studio', label: 'Utilisateurs', icon: UsersIcon, Component: UsersTab },
  { key: 'identity', group: 'Studio', label: 'Identité (SSO)', icon: Fingerprint, Component: IdentityTab },
  { key: 'system', group: 'Studio', label: 'Système', icon: Server, Component: SystemTab },
  { key: 'settings', group: 'Studio', label: 'Réglages', icon: SettingsIcon, Component: SettingsTab },
  {
    key: 'defaults',
    group: 'Studio',
    label: 'Défauts projet',
    icon: FolderCog,
    Component: ProjectDefaultsTab,
  },
  { key: 'hdri', group: 'Contextes de review', label: '3D & Splat', icon: Box, Component: HdriTab },
  { key: 'video', group: 'Contextes de review', label: 'Vidéo', icon: Video, Component: TranscodeTab },
  {
    key: 'distribution',
    group: 'Contextes de review',
    label: 'Diffusion',
    icon: Share2,
    Component: DistributionTab,
  },
  {
    key: 'review-statuses',
    group: 'Contextes de review',
    label: 'Statuts',
    icon: ClipboardCheck,
    Component: ReviewStatusTab,
  },
  {
    key: 'announcements',
    group: 'Communications',
    label: 'Annonces',
    icon: Megaphone,
    Component: AnnouncementsTab,
  },
  { key: 'smtp', group: 'Communications', label: 'SMTP', icon: Mail, Component: SmtpTab },
  {
    key: 'api',
    group: 'Communications',
    label: 'API & Webhooks',
    icon: KeyRound,
    Component: ApiWebhooksTab,
  },
  { key: 'jobs', group: 'Maintenance', label: 'Jobs', icon: ListChecks, Component: JobsTab },
  { key: 'trash', group: 'Maintenance', label: 'Corbeille', icon: Trash2, Component: TrashTab },
  { key: 'audit', group: 'Maintenance', label: 'Audit', icon: History, Component: AuditTab },
  {
    key: 'media-access',
    group: 'Maintenance',
    label: 'Accès médias',
    icon: Eye,
    Component: MediaAccessTab,
  },
] as const;

const GROUPS = ['Studio', 'Contextes de review', 'Communications', 'Maintenance'] as const;

export default function AdminPage() {
  const role = useAuth((s) => s.user?.role);
  const { section } = useParams();
  if (role !== 'ADMIN') {
    return (
      <Shell title="Administration">
        <p className="text-sm text-destructive">Accès réservé aux administrateurs.</p>
      </Shell>
    );
  }
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const Active = active.Component;

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">Administration</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-52 md:flex-col md:overflow-visible md:pb-0">
          {GROUPS.map((group) => (
            <div key={group} className="flex gap-1 md:flex-col">
              <div className="hidden px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:pt-0 md:block">
                {group}
              </div>
              {SECTIONS.filter((s) => s.group === group).map((s) => {
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
