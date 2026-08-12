import type { ReactNode } from "react";

// Minimal Markdown -> React renderer for Emmy's replies: headings, bold,
// italic, inline code, code blocks, links, lists, blockquotes, tables, rules.
// No new dependency — same approach as web/src/obsidian/miniMarkdown.tsx, but
// without wikilinks (irrelevant here) and with code blocks/tables added,
// since research reports commonly use both.

const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

const INLINE_PATTERN = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${i++}`;

    if (match[1] !== undefined) {
      nodes.push(<code key={key}>{match[1]}</code>);
    } else if (match[2] !== undefined) {
      const href = match[3];
      nodes.push(
        SAFE_LINK_SCHEME.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {match[2]}
          </a>
        ) : (
          <span key={key}>{match[2]}</span>
        ),
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

function renderTable(rows: string[][], key: string): ReactNode {
  const [head, ...body] = rows;
  return (
    <table key={key}>
      <thead>
        <tr>
          {head.map((cell, i) => (
            <th key={i}>{renderInline(cell, `${key}-h${i}`)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td key={c}>{renderInline(cell, `${key}-${r}-${c}`)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** A separator row like "---|:---:|---" — only cells made of dashes/colons/spaces. */
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

export function renderMiniMarkdown(markdown: string): ReactNode {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: { ordered: boolean; text: string }[] | null = null;
  let quoteLines: string[] | null = null;
  let blockKey = 0;

  const flushList = () => {
    if (!listItems) return;
    const items = listItems;
    const ordered = items[0]?.ordered ?? false;
    const Tag = ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`list-${blockKey++}`}>
        {items.map((item, i) => <li key={i}>{renderInline(item.text, `li-${blockKey}-${i}`)}</li>)}
      </Tag>,
    );
    listItems = null;
  };

  const flushQuote = () => {
    if (!quoteLines) return;
    const text = quoteLines.join(" ");
    blocks.push(<blockquote key={`q-${blockKey++}`}>{renderInline(text, `q-${blockKey}`)}</blockquote>);
    quoteLines = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = /^```/.exec(line.trim());
    if (fenceMatch) {
      flushList();
      flushQuote();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre key={`code-${blockKey++}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // A pipe-table: a header row immediately followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      flushQuote();
      const rows: string[][] = [splitTableRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(renderTable(rows, `table-${blockKey++}`));
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const orderedMatch = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const bulletMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    const quoteMatch = /^\s*>\s?(.*)$/.exec(line);
    const ruleMatch = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.exec(line);

    if (headingMatch) {
      flushList();
      flushQuote();
      const level = headingMatch[1].length;
      const Tag = `h${Math.min(level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={`h-${blockKey++}`}>{renderInline(headingMatch[2], `h-${blockKey}`)}</Tag>);
    } else if (ruleMatch) {
      flushList();
      flushQuote();
      blocks.push(<hr key={`hr-${blockKey++}`} />);
    } else if (bulletMatch) {
      flushQuote();
      listItems = listItems ?? [];
      listItems.push({ ordered: false, text: bulletMatch[1] });
    } else if (orderedMatch) {
      flushQuote();
      listItems = listItems ?? [];
      listItems.push({ ordered: true, text: orderedMatch[1] });
    } else if (quoteMatch) {
      flushList();
      quoteLines = quoteLines ?? [];
      quoteLines.push(quoteMatch[1]);
    } else if (line.trim() === "") {
      flushList();
      flushQuote();
    } else {
      flushList();
      flushQuote();
      blocks.push(<p key={`p-${blockKey++}`}>{renderInline(line, `p-${blockKey}`)}</p>);
    }
    i++;
  }
  flushList();
  flushQuote();

  return <>{blocks}</>;
}
