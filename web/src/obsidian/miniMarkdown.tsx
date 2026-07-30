import type { ReactNode } from "react";

interface RenderOptions {
  /** Resolves a wikilink's target name to a note path, or undefined if no matching note exists. */
  resolveWikilink: (name: string) => string | undefined;
  onWikilinkClick: (notePath: string) => void;
}

const INLINE_PATTERN =
  /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;

function renderInline(text: string, options: RenderOptions, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${i++}`;

    if (match[1] !== undefined) {
      // [[Name]], [[Name|Alias]] or [[Name#Heading]]
      const raw = match[1];
      const [namePart, alias] = raw.split("|");
      const name = namePart.split("#")[0].trim();
      const label = alias?.trim() || namePart.trim();
      const targetPath = options.resolveWikilink(name);
      nodes.push(
        targetPath ? (
          <button key={key} className="obsidian-wikilink" onClick={() => options.onWikilinkClick(targetPath)}>
            {label}
          </button>
        ) : (
          <span key={key} className="obsidian-wikilink obsidian-wikilink-unresolved" title="Keine passende Notiz gefunden">
            {label}
          </span>
        ),
      );
    } else if (match[2] !== undefined) {
      // [text](url)
      nodes.push(
        <a key={key} href={match[3]} target="_blank" rel="noreferrer noopener">
          {match[2]}
        </a>,
      );
    } else if (match[4] !== undefined || match[5] !== undefined) {
      nodes.push(<strong key={key}>{match[4] ?? match[5]}</strong>);
    } else if (match[6] !== undefined || match[7] !== undefined) {
      nodes.push(<em key={key}>{match[6] ?? match[7]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Minimal Markdown -> React renderer for Obsidian notes: headings, bold, italic, links, wikilinks, lists. No new dependency. */
export function renderMiniMarkdown(markdown: string, options: RenderOptions): ReactNode {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] | null = null;
  let blockKey = 0;

  const flushList = () => {
    if (!listItems) return;
    blocks.push(
      <ul key={`list-${blockKey++}`}>
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item, options, `li-${blockKey}-${i}`)}</li>
        ))}
      </ul>,
    );
    listItems = null;
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const listMatch = /^[-*]\s+(.*)$/.exec(line);
    const embedMatch = /^!\[\[([^\]]+)\]\]$/.exec(line.trim());

    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const Tag = `h${Math.min(level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={`h-${blockKey++}`}>{renderInline(headingMatch[2], options, `h-${blockKey}`)}</Tag>);
    } else if (listMatch) {
      listItems = listItems ?? [];
      listItems.push(listMatch[1]);
    } else if (embedMatch) {
      flushList();
      blocks.push(
        <p key={`embed-${blockKey++}`} className="obsidian-embed-ref">
          🖼 {embedMatch[1]}
        </p>,
      );
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={`p-${blockKey++}`}>{renderInline(line, options, `p-${blockKey}`)}</p>);
    }
  }
  flushList();

  return <>{blocks}</>;
}
