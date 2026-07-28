import { useEffect, useState } from "react";
import { api } from "../api/client";

interface Entry {
  name: string;
  type: "dir" | "file";
  path: string;
}

function TreeNode({
  projectId,
  entry,
  onSelectFile,
}: {
  projectId: string;
  entry: Entry;
  onSelectFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);

  const toggle = async () => {
    if (entry.type === "file") {
      onSelectFile(entry.path);
      return;
    }
    if (!expanded && children === null) {
      const items = await api.get<Entry[]>(
        `/api/projects/${projectId}/tree?path=${encodeURIComponent(entry.path)}`,
      );
      setChildren(items);
    }
    setExpanded((v) => !v);
  };

  return (
    <div className="tree-node">
      <div className="tree-node-label" onClick={toggle}>
        {entry.type === "dir" ? (expanded ? "📂" : "📁") : "📄"} {entry.name}
      </div>
      {expanded && children && (
        <div className="tree-node-children">
          {children.map((child) => (
            <TreeNode key={child.path} projectId={projectId} entry={child} onSelectFile={onSelectFile} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ projectId, onSelectFile }: { projectId: string; onSelectFile: (path: string) => void }) {
  const [rootEntries, setRootEntries] = useState<Entry[]>([]);

  useEffect(() => {
    api.get<Entry[]>(`/api/projects/${projectId}/tree?path=`).then(setRootEntries);
  }, [projectId]);

  return (
    <div className="file-tree">
      {rootEntries.map((entry) => (
        <TreeNode key={entry.path} projectId={projectId} entry={entry} onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}
