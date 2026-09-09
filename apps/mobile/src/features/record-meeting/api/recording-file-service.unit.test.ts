import { describe, expect, it } from 'vitest';

import { detectMimeTypeFromBytes } from './recording-file-service-contract';

function toBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;

  return new Uint8Array(normalized.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
}

describe('detectMimeTypeFromBytes', () => {
  it('ftyp brand를 가진 MP4/M4A byte를 audio/mp4로 판별한다', () => {
    // 'ftyp'은 byte offset 4~8에 온다. 앞 4바이트는 box size다.
    const bytes = toBytes('00000018667479706D70343200000000');

    expect(detectMimeTypeFromBytes(bytes)).toBe('audio/mp4');
  });

  it('ftyp brand가 없으면 허용 목록을 벗어나는 fallback을 돌려준다', () => {
    const bytes = toBytes('49443303000000000000000000000000');

    expect(detectMimeTypeFromBytes(bytes)).toBe('application/octet-stream');
  });

  it('너무 짧은 byte는 fallback을 돌려준다', () => {
    expect(detectMimeTypeFromBytes(new Uint8Array([1, 2, 3]))).toBe('application/octet-stream');
  });
});
