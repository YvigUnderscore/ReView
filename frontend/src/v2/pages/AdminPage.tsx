import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  FolderCog,
  History,
  LayoutDashboard,
  Mail,
  Megaphone,
  Server,
  Video,
  Settings as SettingsIcon,
  Sun,
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
import AnnouncementsTab from './admin/AnnouncementsTab';
import SmtpTab from './admin/SmtpTab';
import TrashTab from './admin/TrashTab';
import AuditTab from './admin/AuditTab';

/** Sections d'administration — sous-routées via /admin/:section (10.C6). */
const SECTIONS = [
  { key: 'overview', label: 'Tableau de bord', icon: LayoutDashboard, Component: OverviewTab },
  { key: 'activity', label: 'Activité', icon: Activity, Component: ActivityTab },
  { key: 'users', label: 'Utilisateurs', icon: UsersIcon, Component: UsersTab },
  { key: 'system', label: 'Système', icon: Server, Component: SystemTab },
  { key: 'settings', label: 'Réglages', icon: SettingsIcon, Component: SettingsTab },
  { key: 'defaults', label: 'Défauts projet', icon: FolderCog, Component: ProjectDefaultsTab },
  { key: 'hdri', label: 'HDRI', icon: Sun, Component: HdriTab },
  { key: 'video', label: 'Vidéo', icon: Video, Component: TranscodeTab },
  { key: 'announcements', label: 'Annonces', icon: Megaphone, Component: AnnouncementsTab },
  { key: 'smtp', label: 'SMTP', icon: Mail, Component: SmtpTab },
  { key: 'trash', label: 'Corbeille', icon: Trash2, Component: TrashTab },
  { key: 'audit', label: 'Audit', icon: History, Component: AuditTab },
] as const;

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
        <nav className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-48 md:flex-col md:overflow-visible md:pb-0">
          {SECTIONS.map((s) => {
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
        </nav>
        <div className="min-w-0 flex-1">
          <Active />
        </div>
      </div>
    </Shell>
  );
}
