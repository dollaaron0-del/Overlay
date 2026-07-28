export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("de-DE");
}
