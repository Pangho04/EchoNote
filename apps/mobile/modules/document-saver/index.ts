import { type NativeModule, requireNativeModule } from 'expo';

export type SaveFileResult = 'saved' | 'cancelled';

declare class DocumentSaverModule extends NativeModule {
  saveFileAsync(fileUri: string, mimeType: string): Promise<SaveFileResult>;
}

const DocumentSaver = requireNativeModule<DocumentSaverModule>('DocumentSaver');

// 시스템 저장 위치 선택 화면을 띄워 file:// 파일의 사본을 저장한다. 실패하면 거절한다.
export function saveFileAsync(fileUri: string, mimeType: string): Promise<SaveFileResult> {
  return DocumentSaver.saveFileAsync(fileUri, mimeType);
}
