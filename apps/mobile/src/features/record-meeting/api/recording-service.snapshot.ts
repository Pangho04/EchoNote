import type { RecorderSnapshot, RecorderStateListener } from './recording-service';

export function createSnapshotManager(initialSnapshot: RecorderSnapshot) {
  let snapshot = initialSnapshot;
  let listener: RecorderStateListener | null = null;

  function publishSnapshot(nextSnapshot: RecorderSnapshot): void {
    const unchanged =
      snapshot.state === nextSnapshot.state &&
      snapshot.durationMs === nextSnapshot.durationMs &&
      snapshot.errorMessage === nextSnapshot.errorMessage;

    if (unchanged) return;

    snapshot = nextSnapshot;
    listener?.(snapshot);
  }

  function subscribe(nextListener: RecorderStateListener): () => void {
    if (listener !== null) {
      throw new Error('이미 녹음 상태 listener가 등록되어 있습니다.');
    }

    listener = nextListener;
    listener(snapshot);

    return () => {
      if (listener === nextListener) {
        listener = null;
      }
    };
  }

  function getSnapshot(): RecorderSnapshot {
    return snapshot;
  }

  function setSnapshot(nextSnapshot: RecorderSnapshot): void {
    snapshot = nextSnapshot;
  }

  function clearListener(): void {
    listener = null;
  }

  return {
    publishSnapshot,
    subscribe,
    getSnapshot,
    setSnapshot,
    clearListener,
  };
}

export type SnapshotManager = ReturnType<typeof createSnapshotManager>;
