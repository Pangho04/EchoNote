export interface OperationContext<TCommand> {
  command: TCommand;
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface OperationQueueConfig<TCommand> {
  timeoutMs: number;
  onTimeout: (command: TCommand) => Error;
  onBusy: (command: TCommand) => Error;
  onDisposed: () => Error;
}

export function createOperationQueue<TCommand>(config: OperationQueueConfig<TCommand>) {
  let activeOperation: OperationContext<TCommand> | null = null;
  let disposed = false;

  function clearActiveOperation(operation: OperationContext<TCommand>): boolean {
    if (activeOperation !== operation) return false;
    clearTimeout(operation.timeoutId);
    activeOperation = null;
    return true;
  }

  function rejectActiveOperation(error: unknown, operation: OperationContext<TCommand>): void {
    if (!clearActiveOperation(operation)) return;
    operation.reject(error);
  }

  function runOperation<T>(command: TCommand, execute: () => Promise<T> | T): Promise<T> {
    if (disposed) return Promise.reject(config.onDisposed());

    if (activeOperation !== null) {
      if (activeOperation.command === command) {
        return activeOperation.promise as Promise<T>;
      }
      return Promise.reject(config.onBusy(command));
    }

    let resolveOperation!: (value: T) => void;
    let rejectOperation!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });

    const operation: OperationContext<TCommand> = {
      command,
      promise,
      resolve: resolveOperation as (value: unknown) => void,
      reject: rejectOperation,
      timeoutId: setTimeout(() => {
        if (activeOperation === operation) {
          rejectActiveOperation(config.onTimeout(command), operation);
        }
      }, config.timeoutMs),
    };

    activeOperation = operation;

    void (async () => {
      try {
        const result = await execute();
        if (disposed || !clearActiveOperation(operation)) return;
        resolveOperation(result);
      } catch (error) {
        if (activeOperation === operation) {
          rejectActiveOperation(error, operation);
        }
      }
    })();

    return promise;
  }

  function rejectActive(error: unknown): void {
    if (activeOperation) {
      rejectActiveOperation(error, activeOperation);
    }
  }

  function dispose(): void {
    disposed = true;
    if (activeOperation) {
      rejectActiveOperation(config.onDisposed(), activeOperation);
    }
  }

  function isDisposed(): boolean {
    return disposed;
  }

  function getActiveCommand(): TCommand | null {
    return activeOperation?.command ?? null;
  }

  return {
    runOperation,
    rejectActive,
    dispose,
    isDisposed,
    getActiveCommand,
  };
}

export type OperationQueue<TCommand> = ReturnType<typeof createOperationQueue<TCommand>>;
