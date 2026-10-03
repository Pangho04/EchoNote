import type { ImportFailure, ImportResult } from './import-recording';

export type PendingImportInput = {
  title: string;
  createdAt: string;
  importRecording(): Promise<ImportResult>;
};

export type PendingImport = {
  title: string;
  createdAt: string;
  result: Promise<ImportResult>;
};

export type PendingImportFailure = {
  meetingId: string;
  title: string;
  result: ImportFailure;
};

type Entry = PendingImport & { settled: ImportResult | null };

// 화면과 무관하게 가져오기를 이어 가고 결과를 consume 전까지 보관한다.
// 가져오기는 파일 전체를 메모리에 읽으므로 한 번에 1건씩 순서대로 돈다.
export function createPendingImports() {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let tail: Promise<unknown> = Promise.resolve();

  return {
    start(meetingId: string, input: PendingImportInput): void {
      const result = tail
        .then(input.importRecording)
        .catch((): ImportResult => ({ kind: 'failed' }));
      const entry: Entry = {
        title: input.title,
        createdAt: input.createdAt,
        result,
        settled: null,
      };

      tail = result;
      entries.set(meetingId, entry);

      // 동기 필드를 먼저 기록해 listener 안의 failures()가 방금 끝난 항목을 보게 한다.
      void result.then((settled) => {
        entry.settled = settled;

        for (const listener of [...listeners]) listener();
      });
    },

    get(meetingId: string): PendingImport | undefined {
      const entry = entries.get(meetingId);

      if (entry === undefined) return undefined;

      return { title: entry.title, createdAt: entry.createdAt, result: entry.result };
    },

    failures(): PendingImportFailure[] {
      const failures: PendingImportFailure[] = [];

      for (const [meetingId, entry] of entries) {
        if (entry.settled === null || entry.settled.kind === 'saved') continue;

        failures.push({ meetingId, title: entry.title, result: entry.settled });
      }

      return failures;
    },

    consume(meetingId: string): void {
      entries.delete(meetingId);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type PendingImports = ReturnType<typeof createPendingImports>;

// ponytail: 상세를 떠난 뒤 settle된 항목은 세션 동안 남는다(건당 제목·시각·결과). 쌓임이 문제되면 정리 기능을 둔다.
export const pendingImports = createPendingImports();
