import { describe, expect, it } from 'vitest';

import { toExportFileName, toTranscriptText } from './export-file';

function contentOf(segments: { startMs: number; text: string }[]) {
  return {
    durationMs: 0,
    segments: segments.map((segment) => ({ ...segment, endMs: segment.startMs })),
  };
}

describe('toTranscriptText', () => {
  it('문장마다 [시각] 문장 줄을 만들고 1시간 미만은 분을 두 자리로 채운다', () => {
    const text = toTranscriptText(
      contentOf([
        { startMs: 5_000, text: '시작' },
        { startMs: 303_000, text: '오분' },
        { startMs: 3_599_000, text: '직전' },
        { startMs: 3_600_000, text: '한시간' },
      ]),
    );

    expect(text).toBe('[00:05] 시작\n[05:03] 오분\n[59:59] 직전\n[1:00:00] 한시간\n');
  });

  it('문장 안 연속 공백·줄바꿈을 1칸으로 줄이고 빈 문장 줄은 뺀다', () => {
    const text = toTranscriptText(
      contentOf([
        { startMs: 0, text: '  첫   문장\n이어짐 ' },
        { startMs: 1_000, text: ' \n ' },
      ]),
    );

    expect(text).toBe('[00:00] 첫 문장 이어짐\n');
  });

  it('모든 문장이 공백이면 빈 문자열이다', () => {
    expect(toTranscriptText(contentOf([{ startMs: 0, text: '   ' }]))).toBe('');
  });
});

describe('toExportFileName', () => {
  it('기본 제목의 :을 _로 바꾼다', () => {
    expect(toExportFileName('2026-10-07 오후 03:12:45_녹음', 'txt')).toBe(
      '2026-10-07 오후 03_12_45_녹음.txt',
    );
  });

  it('파일 이름 금지 문자와 제어 문자를 _로 바꾼다', () => {
    expect(toExportFileName('a/b\\c*d?e"f<g>h|i\u0001j', 'm4a')).toBe('a_b_c_d_e_f_g_h_i_j.m4a');
  });

  it('짝 없는 서로게이트만 _로 바꾸고 이모지는 남긴다', () => {
    expect(toExportFileName('회의\ud83d 😀', 'txt')).toBe('회의_ 😀.txt');
  });

  it('앞뒤 공백과 점을 지우고 비면 echonote를 쓴다', () => {
    expect(toExportFileName(' .회의. ', 'txt')).toBe('회의.txt');
    expect(toExportFileName(' .. ', 'txt')).toBe('echonote.txt');
  });
});
