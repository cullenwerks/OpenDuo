import * as crypto from 'crypto';

interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CONFIRM_TIMEOUT_MS = 120_000; // 2 minutes

export class ConfirmationManager {
  private pending = new Map<string, PendingConfirmation>();

  /**
   * Request user confirmation. Emits a [CONFIRM:id] event via emitToken
   * and returns a Promise that resolves when the user responds.
   */
  requestConfirmation(prompt: string, emitToken: (text: string) => void): Promise<boolean> {
    const id = crypto.randomUUID();

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false); // Timeout = deny
      }, CONFIRM_TIMEOUT_MS);

      this.pending.set(id, { resolve, timer });
      emitToken(`\n[CONFIRM:${id}] ${prompt}\n`);
    });
  }

  /**
   * Resolve a pending confirmation. Returns false if the ID is unknown.
   */
  resolve(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(approved);
    return true;
  }
}
