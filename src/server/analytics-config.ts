/** Optional per-deployment analytics; public forks bring their own measurement ID. */
export function googleAnalyticsId() {
  const id = process.env.GOOGLE_ANALYTICS_ID?.trim();
  return id && /^G-[A-Z0-9]+$/.test(id) ? id : null;
}
