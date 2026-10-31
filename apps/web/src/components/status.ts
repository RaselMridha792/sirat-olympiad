import type { ComponentProps } from 'react';
import type { Badge } from '@sirat/ui';
import type {
  AttemptStatus,
  EntryStatus,
  ExamStatus,
  PaymentStatus,
  Role,
  StudentExamState,
  TaskStatus,
} from '@sirat/shared';

/** One place that maps every status to a Badge tone, so the same status looks the same everywhere. */
type Tone = NonNullable<ComponentProps<typeof Badge>['tone']>;

export const attemptStatusTone: Record<AttemptStatus, Tone> = {
  in_progress: 'info',
  submitted: 'warning',
  expired: 'neutral',
  scored: 'success',
};

export const examStateTone: Record<StudentExamState, Tone> = {
  upcoming: 'warning',
  open: 'success',
  in_progress: 'info',
  submitted: 'brand',
  closed: 'neutral',
};

export const examStatusTone: Record<ExamStatus, Tone> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
};

export const entryStatusTone: Record<EntryStatus, Tone> = {
  pending: 'warning',
  submitted: 'info',
  evaluated: 'neutral',
  promoted: 'success',
  eliminated: 'neutral',
};

export const roleTone: Record<Role, Tone> = {
  student: 'neutral',
  ambassador: 'info',
  manager: 'warning',
  jury: 'brand',
  admin: 'brand',
};

export const taskStatusTone: Record<TaskStatus, Tone> = {
  assigned: 'info',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export const paymentStatusTone: Record<PaymentStatus, Tone> = {
  initiated: 'neutral',
  pending: 'warning',
  paid: 'success',
  failed: 'danger',
  expired: 'neutral',
  refunded: 'info',
};

/**
 * Rank names come from the rank_thresholds config table. Known tiers render as light-background,
 * dark-text badges (silver and gold are unreadable as plain coloured text); other names are neutral.
 */
export function rankTone(name: string | null | undefined): Tone {
  switch (name?.trim().toLowerCase()) {
    case 'gold':
      return 'gold';
    case 'silver':
      return 'silver';
    case 'bronze':
      return 'bronze';
    default:
      return 'neutral';
  }
}
