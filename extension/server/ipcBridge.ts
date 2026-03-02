import * as crypto from 'crypto';

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();
const IPC_TIMEOUT_MS = 5000;

let listenerAttached = false;

/** Handle an incoming IPC message from the extension host. */
function handleMessage(msg: any): void {
  if (msg?.type === 'response' && typeof msg.id === 'string') {
    const req = pending.get(msg.id);
    if (req) {
      pending.delete(msg.id);
      clearTimeout(req.timer);
      if (msg.error) {
        req.reject(new Error(msg.error));
      } else {
        req.resolve(msg.data);
      }
    }
  }
}

function ensureListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  process.on('message', handleMessage);
}

export function sendIpcRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (typeof process.send !== 'function') {
    return Promise.reject(new Error('IPC not available — server not spawned with IPC channel'));
  }

  ensureListener();
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`IPC request '${method}' timed out after ${IPC_TIMEOUT_MS}ms`));
    }, IPC_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    process.send!({ type: 'request', id, method, params });
  });
}

/** Reset internal state for tests. */
export function _resetForTest(): void {
  for (const req of pending.values()) clearTimeout(req.timer);
  pending.clear();
  process.removeListener('message', handleMessage);
  listenerAttached = false;
}

/** Exposed for tests — directly invoke the message handler without process.emit. */
export const _handleMessageForTest = handleMessage;
