import { describe, expect, it } from 'vitest';

import {
  checkDocText,
  checkTrackedFiles,
  checkTranscriptLeak,
  collectTranscriptLines,
} from './verify-gate-c';

const rulesOf = (text: string) => checkDocText('doc.md', text).map((v) => v.rule);

describe('checkTrackedFiles', () => {
  it('미디어 확장자는 대소문자 무관하게 잡고 일반 파일은 통과시킨다', () => {
    const result = checkTrackedFiles(['a/b.M4A', 'demo.mp4', 'x.3gp', 'README.md', 'src/audio.ts']);

    expect(result.map((v) => v.file)).toEqual(['a/b.M4A', 'demo.mp4', 'x.3gp']);
  });
});

describe('checkDocText', () => {
  it.each([
    ['jwt-token', 'token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcDEF_ghi'],
    ['openai-style-key(sk-)', 'key sk-abcdefghijklmnop1234'],
    ['supabase-key(sb_)', 'sb_secret_abcdefghijklmnop1234'],
    ['long-hex-secret', 'a'.repeat(64)],
    ['long-base64-secret', 'AbCdEfGhIj0123456789AbCdEfGhIj0123456789xyz='],
    ['supabase-project-url', 'https://abcdefghijklmnopqrst.supabase.co/rest'],
    ['tailnet-name', 'https://pc.tail1234.ts.net:8443'],
    ['private-ip', 'http://192.168.0.12:4318'],
    ['private-ip', 'http://100.101.102.103'],
    ['absolute-local-path', '/Users/someone/project'],
    ['absolute-local-path', 'C:\\Users\\someone\\x'],
    ['absolute-local-path', '/home/someone/x'],
  ])('%s 규칙이 걸린다', (rule, text) => {
    expect(rulesOf(text)).toContain(rule);
  });

  it('위반 줄 번호를 1부터 센다', () => {
    expect(checkDocText('d.md', 'ok\nhttp://10.0.0.1')).toEqual([
      { file: 'd.md', line: 2, rule: 'private-ip' },
    ]);
  });

  it('일반 문장·커밋 해시·공인 IP·상대 경로는 통과한다', () => {
    const clean = [
      '# EchoNote',
      '커밋 f50e5026d1c0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
      'Supabase는 제어 계층이다. 8.8.8.8 apps/mobile/src/app',
      '<project>.example.com',
    ].join('\n');

    expect(checkDocText('d.md', clean)).toEqual([]);
  });
});

describe('transcript leak', () => {
  const privateText = [
    '[00:01:02] 이번 분기 매출 목표를 다시 조정합시다',
    '화자 1: 일정은 다음 주까지 확정하겠습니다',
    '일반 메모 줄',
  ].join('\n');
  const lines = collectTranscriptLines([privateText]);

  it('시각·화자 표지가 있는 줄만 수집한다', () => {
    expect(lines.size).toBe(2);
  });

  it('공개 문서에 같은 줄이 있으면 file:line으로 잡는다', () => {
    const doc = ['소개', '  [00:01:02]   이번 분기 매출 목표를 다시 조정합시다'].join('\n');

    expect(checkTranscriptLeak('README.md', doc, lines)).toEqual([
      { file: 'README.md', line: 2, rule: 'private-transcript-line' },
    ]);
  });

  it('합성 예시 문장은 통과한다', () => {
    expect(
      checkTranscriptLeak('README.md', '[00:00:01] 안녕하세요 합성 예시입니다 입니다', lines),
    ).toEqual([]);
  });
});
