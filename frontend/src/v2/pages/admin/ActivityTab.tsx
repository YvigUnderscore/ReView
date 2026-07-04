import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import MiniBarChart from '../../components/MiniBarChart';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Panel } from './AdminPrimitives';
import { dayLabel, fmtBytes, type ActivityData } from './adminShared';

export default function ActivityTab() {
  const { data } = useQuery({
    queryKey: qk.admin('activity'),
    queryFn: () => api.get<ActivityData>('/api/admin/activity?days=30'),
  });
  if (!data) return <SkeletonRows count={5} />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`Uploads / jour (${data.days} j)`}>
        <MiniBarChart data={data.uploads.map((u) => ({ label: dayLabel(u.day), value: u.count }))} />
      </Panel>
      <Panel title={`Octets uploadés / jour (${data.days} j)`}>
        <MiniBarChart
          data={data.uploads.map((u) => ({ label: dayLabel(u.day), value: u.bytes }))}
          color="#22c55e"
          valueFormat={fmtBytes}
        />
      </Panel>
      <Panel title={`Nouveaux comptes / jour (${data.days} j)`}>
        <MiniBarChart
          data={data.signups.map((u) => ({ label: dayLabel(u.day), value: u.count }))}
          color="#f59e0b"
        />
      </Panel>
    </div>
  );
}
