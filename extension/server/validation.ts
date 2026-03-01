export function validateChatRequest(message: unknown): string | null {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return 'Message must be a non-empty string';
  }
  if (message.length > 10_000) {
    return 'Message exceeds maximum length of 10,000 characters';
  }
  return null;
}
