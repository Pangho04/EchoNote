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
    .refine((text) => text.trim() !== '')
    // jsonb가 NUL과 짝 없는 surrogate를 거부하므로 저장 전에 막는다. u 플래그라 짝 맞은 이모지는 통과한다.
    .refine((text) => !text.includes('\u0000'))
    .refine((text) => !/\p{Cs}/u.test(text)),
});

// Worker가 전사한 결과. segment는 시작 시각 순서이고 전부 durationMs 안에 있다.
export const transcriptResultSchema = z
  .strictObject({
    durationMs: msSchema.max(MAX_DURATION_MS),
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

export type TranscriptResult = z.infer<typeof transcriptResultSchema>;
