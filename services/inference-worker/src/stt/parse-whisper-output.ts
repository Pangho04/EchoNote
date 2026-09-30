import { transcriptResultSchema } from '@echonote/contracts';
import { z } from 'zod';

const whisperOutputSchema = transcriptResultSchema.safeExtend({ schemaVersion: z.literal(1) });

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
