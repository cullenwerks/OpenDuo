export function validateChatRequest(message: string): string | null {
  if (!message || message.trim().length === 0) {
    return 'Message cannot be empty';
  }
  if (message.length > 10_000) {
    return 'Message exceeds maximum length of 10,000 characters';
  }
  return null;
}
