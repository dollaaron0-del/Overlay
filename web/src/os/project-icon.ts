// Pool a project without a manually chosen icon (see ProjectWorkspace's icon
// picker) is assigned from, deterministically by id — so projects look
// distinct on the homescreen out of the box instead of all sharing one
// generic folder glyph.
const DEFAULT_ICON_POOL = ["🚀", "💻", "🌐", "🔧", "📦", "🗂", "⚙️", "📊", "🔒", "🎨", "🛠", "📡", "🧩", "☁️", "🐳", "🔥", "📈"];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function defaultProjectIcon(projectId: string): string {
  return DEFAULT_ICON_POOL[hashString(projectId) % DEFAULT_ICON_POOL.length];
}
