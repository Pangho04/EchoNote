import type { TranscriptContent } from '@/entities/transcript';
import { formatStartLabel } from '@/shared/lib/format-start-label';

export type ExportKind = 'transcript' | 'recording';

export type ExportRequest =
  | { kind: 'transcript'; title: string; content: TranscriptContent }
  | { kind: 'recording'; title: string; recordingUri: string };

// 서로게이트 쌍은 그대로 두고, 짝 없는 서로게이트·파일 이름 금지 문자·제어 문자만 고른다.
const FILE_NAME_UNSAFE =
  // eslint-disable-next-line no-control-regex
  /[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]|[/\\:*?"<>|\u0000-\u001f\u007f]/g;

// 시각은 화면 전사 목록과 같게 분을 두 자리로 채운다.
export function toTranscriptText(content: TranscriptContent): string {
  return content.segments
    .map((segment) => ({
      startMs: segment.startMs,
      text: segment.text.replace(/\s+/g, ' ').trim(),
    }))
    .filter((segment) => segment.text !== '')
    .map((segment) => `[${formatStartLabel(segment.startMs).padStart(5, '0')}] ${segment.text}\n`)
    .join('');
}

export function toExportFileName(title: string, extension: 'txt' | 'm4a'): string {
  const base = title
    .replace(FILE_NAME_UNSAFE, (match) => (match.length === 2 ? match : '_'))
    .replace(/^[\s.]+|[\s.]+$/g, '');

  return `${base === '' ? 'echonote' : base}.${extension}`;
}
