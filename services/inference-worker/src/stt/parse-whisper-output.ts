import { z } from 'zod';

const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const MAX_SEGMENTS = 20_000;
const MAX_TEXT_LENGTH = 2_000;

const msSchema = z.int().min(0);

const segmentSchema = z.strictObject({
  endMs: msSchema,
  startMs: msSchema,
  text: z
    .string()
    .max(MAX_TEXT_LENGTH)
    .refine((text) => text.trim() !== ''),
});

const whisperOutputSchema = z
  .strictObject({
    durationMs: msSchema.max(MAX_DURATION_MS),
    schemaVersion: z.literal(1),
    segments: z.array(segmentSchema).max(MAX_SEGMENTS),
  })
  .refine(({ durationMs, segments }) =>
    segments.every(
      ({ endMs, startMs }, index) =>
        startMs <= endMs &&
        endMs <= durationMs &&
        (index === 0 || segments[index - 1]!.startMs <= startMs),
    ),
  );

export type ParsedTranscript = z.infer<typeof whisperOutputSchema>;

// 전사 본문이 로그로 새지 않게 Zod issue를 cause로 싣지 않는다.
export class WhisperOutputParseError extends Error {
  readonly code = 'INVALID_WHISPER_OUTPUT';

  constructor() {
    super('INVALID_WHISPER_OUTPUT');
    this.name = 'WhisperOutputParseError';
  }
}

// 컨테이너가 쓴 result.json을 신뢰하지 않고 계약을 검사한다. 반올림·clamp는 transcribe.py가 한다.
export const parseWhisperOutput = (raw: unknown): ParsedTranscript => {
  const result = whisperOutputSchema.safeParse(raw);

  if (!result.success) throw new WhisperOutputParseError();

  return result.data;
};
