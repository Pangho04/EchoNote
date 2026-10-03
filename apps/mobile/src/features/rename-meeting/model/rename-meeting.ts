import type { MeetingRepository } from '@/entities/meeting';

const MAX_TITLE_LENGTH = 80;

// trim → 연속 공백 1칸 → 80자 자르기. 빈 값으로 기본 제목을 만드는 nomalizeMeetingTitle과는 다른 목적이다.
export function normalizeMeetingRenameTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH);
}

export type RenameMeetingDependencies = {
  repository: Pick<MeetingRepository, 'rename'>;
  now(): string;
};

export type RenameMeetingInput = {
  meetingId: string;
  title: string;
};

export async function renameMeeting(
  deps: RenameMeetingDependencies,
  input: RenameMeetingInput,
): Promise<void> {
  await deps.repository.rename({
    meetingId: input.meetingId,
    title: normalizeMeetingRenameTitle(input.title),
    updatedAt: deps.now(),
  });
}
