import type { AxiosInstance } from 'axios';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { createSQLiteTranscriptionRepository } from '@/entities/transcript';

import { checkDesktopLive } from '../api/desktop-live';
import { createTranscriptionGateway } from '../api/transcription-gateway';
import { uploadRecording } from '../api/upload-recording';
import type { RequestTranscriptionDeps } from './request-transcription';

// 업로드 요청이 진행 중인 회의. 같은 회의 상세가 둘 열려도 업로드는 하나만 돌게 앱 전체가 공유한다.
const uploadingMeetingIds = new Set<string>();

export type TranscriptionDeps = RequestTranscriptionDeps & {
  uploadingMeetingIds: Set<string>;
};

export function createTranscriptionDeps(
  database: SQLiteDatabase,
  gateway: AxiosInstance,
): TranscriptionDeps {
  return {
    transcriptions: createSQLiteTranscriptionRepository(database),
    gateway: createTranscriptionGateway(gateway),
    checkDesktopLive,
    uploadRecording,
    createIdempotencyKey: () => Crypto.randomUUID(),
    uploadingMeetingIds,
  };
}
