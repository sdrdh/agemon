/** Map common error patterns to user-friendly messages */
export function friendlyError(error: unknown, fallback: string): string {
  if (!error) return fallback;

  const message = error instanceof Error ? error.message : String(error);

  // Log technical detail for debugging
  console.error('[Agemon]', error);

  // Network errors
  if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('ERR_CONNECTION')) {
    return 'Unable to reach the server. Check your connection and try again.';
  }

  // Auth errors
  if (message.includes('401') || message.includes('Unauthorized')) {
    return 'Session expired. Please log in again.';
  }

  // Not found
  if (message.includes('404') || message.includes('Not Found') || message.includes('not found')) {
    return 'The requested resource was not found.';
  }

  // Agent not found / ACP binary missing
  if (message.includes('claude-agent-acp') || message.includes('agent binary')) {
    return 'Agent binary not found. Ensure claude-agent-acp is installed and on PATH.';
  }

  // Server errors
  if (message.includes('500') || message.includes('Internal Server Error')) {
    return 'Something went wrong on the server. Please try again.';
  }

  // Rate limiting
  if (message.includes('429') || message.includes('Too Many Requests')) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  // If the error message is reasonably short and readable, use it directly
  if (message.length < 100 && !message.includes('at ') && !message.includes('Error:')) {
    return message;
  }

  return fallback;
}
