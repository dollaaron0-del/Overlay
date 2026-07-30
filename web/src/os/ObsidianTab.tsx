import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { renderMiniMarkdown } from "../obsidian/miniMarkdown";

interface NoteSummary {
  path: string;
  title: string;
  tags: string[];
}

interface NoteDetail extends NoteSummary {
  frontmatter: Record<string, string | string[]> | null;
  body: string;
  wikilinks: string[];
  backlinks: string[];
}

export function ObsidianTab({ projectId, projectDirName }: { projectId: string; projectDirName: string }) {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  useEffect(() => {
    setNotes(null);
    setSelectedPath(null);
    setTagFilter(null);
    api
      .get<NoteSummary[]>(`/api/projects/${projectId}/obsidian/notes`)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [projectId]);

  useEffect(() => {
    if (!selectedPath) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    api
      .get<NoteDetail>(`/api/projects/${projectId}/obsidian/note?path=${encodeURIComponent(selectedPath)}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedPath]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes ?? []) for (const t of n.tags) set.add(t);
    return [...set].sort();
  }, [notes]);

  const filteredNotes = (notes ?? []).filter((n) => !tagFilter || n.tags.includes(tagFilter));

  const resolveWikilink = (name: string): string | undefined => {
    const target = name.trim().toLowerCase();
    return notes?.find((n) => {
      const base = n.path.replace(/\.md$/, "").split("/").pop()!.toLowerCase();
      return base === target || n.path.toLowerCase() === target || n.path.toLowerCase() === `${target}.md`;
    })?.path;
  };

  const titleFor = (notePath: string): string => notes?.find((n) => n.path === notePath)?.title ?? notePath;

  if (notes === null) return <p className="empty-hint">Lädt…</p>;

  return (
    <div className="plans-tab obsidian-tab">
      <div className="plans-list obsidian-notes-list">
        {allTags.length > 0 && (
          <div className="obsidian-tag-filter">
            <button className={!tagFilter ? "active" : ""} onClick={() => setTagFilter(null)}>
              Alle
            </button>
            {allTags.map((t) => (
              <button key={t} className={tagFilter === t ? "active" : ""} onClick={() => setTagFilter(t)}>
                #{t}
              </button>
            ))}
          </div>
        )}
        {filteredNotes.length === 0 ? (
          <p className="empty-hint">Keine Notizen gefunden.</p>
        ) : (
          filteredNotes.map((n) => (
            <button
              key={n.path}
              className={`plans-list-item ${selectedPath === n.path ? "active" : ""}`}
              onClick={() => setSelectedPath(n.path)}
            >
              {n.title}
            </button>
          ))
        )}
      </div>

      <div className="obsidian-detail-panel">
        {!selectedPath && <p className="empty-hint">Wähle eine Notiz.</p>}
        {selectedPath && !detail && <p className="empty-hint">Lädt…</p>}
        {detail && (
          <>
            <div className="obsidian-detail-header">
              <h3>{detail.title}</h3>
              <a
                className="obsidian-deeplink"
                href={`obsidian://open?vault=${encodeURIComponent(projectDirName)}&file=${encodeURIComponent(
                  detail.path.replace(/\.md$/, ""),
                )}`}
              >
                In Obsidian öffnen
              </a>
            </div>

            {detail.frontmatter && Object.keys(detail.frontmatter).length > 0 && (
              <div className="obsidian-frontmatter-chips">
                {Object.entries(detail.frontmatter).map(([key, value]) => (
                  <span key={key} className="obsidian-chip">
                    {key}: {Array.isArray(value) ? value.join(", ") : value}
                  </span>
                ))}
              </div>
            )}

            <div className="obsidian-note-body">
              {renderMiniMarkdown(detail.body, { resolveWikilink, onWikilinkClick: setSelectedPath })}
            </div>

            {detail.backlinks.length > 0 && (
              <div className="obsidian-backlinks">
                <h4>Backlinks</h4>
                <ul>
                  {detail.backlinks.map((bp) => (
                    <li key={bp}>
                      <button onClick={() => setSelectedPath(bp)}>{titleFor(bp)}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
