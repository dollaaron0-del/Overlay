import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { MermaidDiagram } from "./MermaidDiagram";

// Markdown -> React renderer for Emmy's replies: headings, bold, italic,
// inline code, code blocks, links, nested lists, blockquotes, tables, rules,
// plus two heavier renderers used only when their syntax actually appears:
// ```mermaid code blocks (diagrams, via MermaidDiagram) and $$...$$ blocks
// (math, via KaTeX). Same approach as web/src/obsidian/miniMarkdown.tsx for
// the base syntax, extended here since research reports commonly need
// structure and diagrams beyond plain prose.

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

/** $$...$$ blocks rendered via KaTeX; falls back to plain text if the LaTeX doesn't parse. */
function renderMathBlock(latex: string, key: string): ReactNode {
  try {
    const html = katex.renderToString(latex, { throwOnError: false, displayMode: true });
    return <div key={key} className="emmy2-math" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return (
      <pre key={key}>
        <code>{latex}</code>
      </pre>
    );
  }
}

interface ListItem {
  ordered: boolean;
  text: string;
  indent: number;
}

/**
 * Turns a flat, indent-tagged run of list items into a properly nested
 * <ul>/<ol> tree — a nested item becomes a child list inside its parent's
 * <li>, rather than every item landing flat regardless of indentation.
 * Returns the list node plus the index it stopped at (first item whose
 * indent is shallower than `indent`, i.e. belongs to an ancestor level).
 */
function buildNestedList(items: ListItem[], start: number, indent: number, keyPrefix: string): [ReactNode, number] {
  const liNodes: ReactNode[] = [];
  let i = start;
  let ordered = items[start].ordered;
  let n = 0;
  while (i < items.length && items[i].indent === indent) {
    const item = items[i];
    ordered = item.ordered;
    const itemIndex = i;
    i++;
    let child: ReactNode = null;
    if (i < items.length && items[i].indent > indent) {
      [child, i] = buildNestedList(items, i, items[i].indent, `${keyPrefix}-${n}`);
    }
    liNodes.push(
      <li key={`${keyPrefix}-li-${itemIndex}`}>
        {renderInline(item.text, `${keyPrefix}-txt-${itemIndex}`)}
        {child}
      </li>,
    );
    n++;
  }
  const Tag = ordered ? "ol" : "ul";
  return [<Tag key={`${keyPrefix}-list`}>{liNodes}</Tag>, i];
}

export function renderMiniMarkdown(markdown: string): ReactNode {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: ListItem[] | null = null;
  let quoteLines: string[] | null = null;
  let blockKey = 0;

  const flushList = () => {
    if (!listItems) return;
    const [node] = buildNestedList(listItems, 0, listItems[0].indent, `list-${blockKey++}`);
    blocks.push(node);
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
    const fenceMatch = /^```\s*(\S*)/.exec(line.trim());
    if (fenceMatch) {
      flushList();
      flushQuote();
      const lang = fenceMatch[1].toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const code = codeLines.join("\n");
      blocks.push(
        lang === "mermaid" ? (
          <MermaidDiagram key={`mermaid-${blockKey++}`} code={code} />
        ) : (
          <pre key={`code-${blockKey++}`}>
            <code>{code}</code>
          </pre>
        ),
      );
      continue;
    }

    // A $$...$$ math block, either fenced across multiple lines or self-
    // contained on one line.
    const mathInlineBlockMatch = /^\$\$(.+)\$\$$/.exec(line.trim());
    if (line.trim() === "$$") {
      flushList();
      flushQuote();
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // skip closing $$
      blocks.push(renderMathBlock(mathLines.join("\n"), `math-${blockKey++}`));
      continue;
    }
    if (mathInlineBlockMatch) {
      flushList();
      flushQuote();
      blocks.push(renderMathBlock(mathInlineBlockMatch[1], `math-${blockKey++}`));
      i++;
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
    const orderedMatch = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    const bulletMatch = /^(\s*)[-*+]\s+(.*)$/.exec(line);
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
      listItems.push({ ordered: false, text: bulletMatch[2], indent: bulletMatch[1].length });
    } else if (orderedMatch) {
      flushQuote();
      listItems = listItems ?? [];
      listItems.push({ ordered: true, text: orderedMatch[2], indent: orderedMatch[1].length });
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
