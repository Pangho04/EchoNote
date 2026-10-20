import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Violation {
  file: string;
  line: number;
  rule: string;
}

const PUBLIC_DOCS = [
  'README.md',
  'PORTFOLIO.md',
  'docs/ARCHITECTURE.md',
  'docs/DECISIONS.md',
  'docs/BACKLOG.md',
  'docs/PRD.md',
  'docs/SPEC.md',
];

const MEDIA_EXTENSIONS = new Set([
  'm4a',
  'mp3',
  'wav',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'wma',
  'amr',
  'caf',
  'aiff',
  'aif',
  '3gp',
  '3gpp',
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'wmv',
  'flv',
  'pcm',
]);

/** 정규식은 문서 한 줄에 적용한다. 규칙 이름이 출력에 그대로 나간다. */
const TEXT_RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: 'jwt-token', pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/ },
  { rule: 'openai-style-key(sk-)', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { rule: 'supabase-key(sb_)', pattern: /\bsb_[A-Za-z0-9_]{16,}/ },
  { rule: 'long-hex-secret', pattern: /\b[0-9a-fA-F]{64,}\b/ },
  {
    rule: 'long-base64-secret',
    pattern:
      /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/_-])/,
  },
  { rule: 'supabase-project-url', pattern: /[A-Za-z0-9-]+\.supabase\.co\b/ },
  { rule: 'tailnet-name', pattern: /[A-Za-z0-9-]+\.ts\.net\b/ },
  {
    rule: 'private-ip',
    pattern:
      /(?<![\d.])(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}(?![\d.])/,
  },
  {
    rule: 'absolute-local-path',
    pattern: /\/Users\/|C:\\Users\\|C:\/Users\/|\/home\/[A-Za-z0-9_.-]+/,
  },
];

/** 전사문처럼 보이는 줄: 시각 또는 화자 표지로 시작하고 본문이 붙어 있다. */
const TRANSCRIPT_LINE =
  /^\s*(?:[-*>]\s*)?(?:\[?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\]?|(?:화자|speaker|SPEAKER)[ _]?\d+)\s*[:\]-]?\s*\S/;
const MIN_TRANSCRIPT_LENGTH = 20;

const normalize = (line: string) => line.replace(/\s+/g, ' ').trim();

export function checkTrackedFiles(paths: string[]): Violation[] {
  return paths
    .filter((path) => MEDIA_EXTENSIONS.has(path.split('.').pop()?.toLowerCase() ?? ''))
    .map((file) => ({ file, line: 0, rule: 'media-file-tracked' }));
}

export function checkDocText(file: string, text: string): Violation[] {
  const violations: Violation[] = [];

  text.split('\n').forEach((content, index) => {
    for (const { rule, pattern } of TEXT_RULES) {
      if (pattern.test(content)) violations.push({ file, line: index + 1, rule });
    }
  });

  return violations;
}

/** private-docs 텍스트에서 전사문처럼 보이는 줄을 정규화해 모은다. */
export function collectTranscriptLines(privateTexts: string[]): Set<string> {
  const lines = new Set<string>();

  for (const text of privateTexts) {
    for (const content of text.split('\n')) {
      const normalized = normalize(content);
      if (normalized.length >= MIN_TRANSCRIPT_LENGTH && TRANSCRIPT_LINE.test(content)) {
        lines.add(normalized);
      }
    }
  }

  return lines;
}

export function checkTranscriptLeak(
  file: string,
  text: string,
  transcriptLines: Set<string>,
): Violation[] {
  const violations: Violation[] = [];

  text.split('\n').forEach((content, index) => {
    if (transcriptLines.has(normalize(content))) {
      violations.push({ file, line: index + 1, rule: 'private-transcript-line' });
    }
  });

  return violations;
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** worktree에는 gitignore된 private-docs가 없으므로 주 체크아웃도 찾는다. */
function findPrivateDocsDir(root: string): string | null {
  const commonDir = resolve(root, git(root, 'rev-parse', '--git-common-dir').trim());
  return (
    [join(root, 'private-docs'), join(dirname(commonDir), 'private-docs')].find(existsSync) ?? null
  );
}

function readPrivateTexts(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(md|txt|srt|vtt|json)$/i.test(entry.name))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'));
}

export function run(root: string): { violations: Violation[]; notes: string[] } {
  const notes: string[] = [];
  const tracked = git(root, 'ls-files').split('\n').filter(Boolean);
  const violations = checkTrackedFiles(tracked);

  const privateDir = findPrivateDocsDir(root);
  const transcriptLines = privateDir
    ? collectTranscriptLines(readPrivateTexts(privateDir))
    : new Set<string>();
  if (!privateDir) notes.push('private-docs 없음: 전사문 대조 건너뜀');

  for (const doc of PUBLIC_DOCS) {
    const path = join(root, doc);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    violations.push(...checkDocText(doc, text), ...checkTranscriptLeak(doc, text, transcriptLines));
  }

  notes.push(
    `추적 파일 ${tracked.length}개, 공개 문서 ${PUBLIC_DOCS.filter((d) => existsSync(join(root, d))).length}개 검사`,
  );
  return { violations, notes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
  const { violations, notes } = run(root);

  for (const { file, line, rule } of violations) console.error(`${file}:${line}: ${rule}`);
  for (const note of notes) console.log(note);
  console.log(violations.length ? `실패: 위반 ${violations.length}건` : '통과: 위반 0건');
  process.exit(violations.length ? 1 : 0);
}
