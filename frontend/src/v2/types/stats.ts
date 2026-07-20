// Statistiques de review (43.A — GET /api/projects/:id/stats). Miroir de backend StatsService.

export type ShotStatStatus = 'approved' | 'inReview' | 'retake' | 'notStarted';

export interface ShotStat {
  shotId: number;
  code: string;
  name: string;
  sequenceId: number | null;
  versions: number;
  retakes: number;
  openNotes: number;
  reviewDays: number | null;
  status: ShotStatStatus;
}

export interface SequenceConvergence {
  sequenceId: number | null;
  code: string;
  name: string;
  total: number;
  approved: number;
  inReview: number;
  retake: number;
  notStarted: number;
}

export interface ProjectStats {
  totals: {
    shots: number;
    versions: number;
    decisions: number;
    approvalRate: number;
    openNotes: number;
    avgReviewDays: number | null;
    avgRetakesPerShot: number;
    avgNotesPerVersion: number;
  };
  sequences: SequenceConvergence[];
  slowestShots: ShotStat[];
}
