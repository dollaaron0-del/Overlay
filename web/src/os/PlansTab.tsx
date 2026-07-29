import { useEffect, useState } from "react";
import { api } from "../api/client";
import { FileViewer } from "../files/FileViewer";

interface TreeEntry {
  name: string;
  type: "dir" | "file";
  path: string;
}

interface PlanItem {
  path: string;
  title: string;
}

/** Pulls the "# Ideenplan: <title>" heading plan-writer.ts always writes, falling back to the raw filename. */
function titleFromContent(content: string, fallback: string): string {
  const match = /^#\s*Ideenplan:\s*(.+)$/m.exec(content);
  return match?.[1]?.trim() || fallback;
}

export function PlansTab({ projectId }: { projectId: string }) {
  const [plans, setPlans] = useState<PlanItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlans(null);
    setSelected(null);

    api
      .get<TreeEntry[]>(`/api/projects/${projectId}/tree?path=plans`)
      .then(async (entries) => {
        const files = entries.filter((e) => e.type === "file" && e.name.endsWith(".md"));
        const items = await Promise.all(
          files.map(async (f) => {
            try {
              const content = await api.get<string>(`/api/projects/${projectId}/file?path=${encodeURIComponent(f.path)}`);
              return { path: f.path, title: titleFromContent(content, f.name) };
            } catch {
              return { path: f.path, title: f.name };
            }
          }),
        );
        if (!cancelled) setPlans(items.reverse()); // filenames are ISO-timestamp-prefixed, so newest first
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (plans === null) return <p className="empty-hint">Lädt…</p>;

  return (
    <div className="plans-tab">
      <div className="plans-list">
        {plans.length === 0 ? (
          <p className="empty-hint">
            Noch keine gespeicherten Pläne. In der "Ideen"-App eine Idee besprechen und dort "Als Plan speichern".
          </p>
        ) : (
          plans.map((p) => (
            <button
              key={p.path}
              className={`plans-list-item ${selected === p.path ? "active" : ""}`}
              onClick={() => setSelected(p.path)}
            >
              {p.title}
            </button>
          ))
        )}
      </div>
      <FileViewer projectId={projectId} path={selected} />
    </div>
  );
}
