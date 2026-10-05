import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import type { RecordingImportService } from '../model/import-recording';

// 플레이어가 파일을 열어 길이를 알 때까지 기다린다. 열지 못하면 timeout으로 끝낸다.
async function readDurationMs(uri: string, timeoutMs: number): Promise<number> {
  const player = createAudioPlayer({ uri });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: { remove(): void } | undefined;

  try {
    return await new Promise<number>((resolve, reject) => {
      const resolveWhenLoaded = (): void => {
        if (player.isLoaded && player.duration > 0) resolve(Math.round(player.duration * 1000));
      };

      timer = setTimeout(() => reject(new Error('Recording duration read timed out.')), timeoutMs);
      subscription = player.addListener('playbackStatusUpdate', resolveWhenLoaded);
      resolveWhenLoaded();
    });
  } finally {
    clearTimeout(timer);
    subscription?.remove();
    player.remove();
  }
}

export function createNativeRecordingImportService(): RecordingImportService {
  return {
    async pickRecording() {
      const picked = await File.pickFileAsync({ mimeTypes: ['audio/mp4', 'audio/x-m4a'] });

      if (picked.canceled) return null;

      return { uri: picked.result.uri, size: picked.result.size, name: picked.result.name };
    },

    async copyToCache({ sourceUri, meetingId }) {
      const copy = new File(Paths.cache, `${meetingId}.m4a`);

      if (copy.exists) copy.delete();

      try {
        await new File(sourceUri).copy(copy);
      } catch (error) {
        // 중간에 끊긴 사본은 호출자가 경로를 모르므로 여기서 지운다.
        if (copy.exists) copy.delete();

        throw error;
      }

      return { uri: copy.uri, size: copy.size };
    },

    async readHeaderBytes(uri, length) {
      const handle = new File(uri).open();

      try {
        return handle.readBytes(length);
      } finally {
        handle.close();
      }
    },

    readDurationMs,
  };
}
