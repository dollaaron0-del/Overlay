/** Lowercase, [a-z0-9-] only, no leading/trailing/duplicate dashes — never a raw path segment from client input. */
export function slugify(input: string, fallback = "idee"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || fallback;
}
