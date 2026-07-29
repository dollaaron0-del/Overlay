const ACTIVITY_LAST_VIEWED_KEY = "overlay-activity-last-viewed";

export function markActivityViewed(): void {
  localStorage.setItem(ACTIVITY_LAST_VIEWED_KEY, new Date().toISOString());
}

export function getActivityLastViewed(): string | null {
  return localStorage.getItem(ACTIVITY_LAST_VIEWED_KEY);
}
