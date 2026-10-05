import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { RecordingImportService } from '../model/import-recording';

// 삼성 음성 녹음의 .m4a는 3GP 컨테이너라 Android 선택기가 audio/mpeg로 분류한다.
// 선택만 넓히고, MP4 계열이 아닌 파일은 가져오기의 헤더 검사가 막는다.
const PICKER_MIME_TYPES =
  Platform.OS === 'android'
    ? ['audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/3gpp']
    : ['audio/mp4', 'audio/x-m4a'];

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
      const picked = await File.pickFileAsync({ mimeTypes: PICKER_MIME_TYPES });

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
