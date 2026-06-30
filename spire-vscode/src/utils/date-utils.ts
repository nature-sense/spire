export function isoTimestamp(): string {
  return new Date().toISOString();
}

export function formatTimeAgo(isoString: string | null | undefined): string {
  if (!isoString) return 'unknown';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return 'unknown';
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} month${diffMonth !== 1 ? 's' : ''} ago`;
}
