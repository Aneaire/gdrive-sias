const remoteMethodPrefix = /^Error invoking remote method '[^']+': Error:\s*/

export function messageFromError(error: unknown) {
  if (!(error instanceof Error)) return 'Unexpected error.'

  const message = error.message.replace(remoteMethodPrefix, '').trim()
  if (!message) return 'Unexpected error.'

  if (/\bInvalidSecret\b|\bInvalidAccountId\b|Invalid credentials/i.test(message)) {
    return 'Invalid email or password.'
  }

  if (/\bTooManyFailedAttempts\b/i.test(message)) {
    return 'Too many failed sign-in attempts. Try again later.'
  }

  const cleaned = message
    .replace(/^\[CONVEX[^\]]+\]\s*/i, '')
    .replace(/^\[Request ID:[^\]]+\]\s*/i, '')
    .replace(/^Server Error\s*/i, '')
    .replace(/^Uncaught Error:\s*/i, '')
    .trim()

  const firstLine = cleaned
    .split(/\n|\s+at async\s+|\s+at [A-Za-z0-9_$]+\s+|\s+Called by client/i)[0]
    ?.trim()
  return firstLine || 'Unexpected error.'
}
