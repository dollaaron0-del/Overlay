import type { ReactNode } from "react";
import { EmmyChart, parseEmmyChartSpec } from "./EmmyChart.js";
import { EmmyMath } from "./EmmyMath.js";
import { EmmyMermaid } from "./EmmyMermaid.js";

// Minimal Markdown -> React renderer for Emmy's replies: headings, bold,
// italic, inline code, code blocks, links, lists (nested), blockquotes,
// tables, rules. Same approach as web/src/obsidian/miniMarkdown.tsx, but
// without wikilinks (irrelevant here) and with code blocks/tables added,
// since research reports commonly use both. ```mermaid and ```chart fences
// get a diagram/chart instead of a plain code block (see EmmyMermaid/EmmyChart),
// and $$...$$ blocks get real typesetting via KaTeX (already a transitive
// mermaid dependency, so this adds no new bytes to the on-demand chunk).

const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;

/** Fenced-code languages we offer a "run in the host terminal" button for. */
const SHELL_LANGS = new Set(["", "bash", "sh", "shell", "zsh", "console", "shell-session", "shellsession", "terminal", "sudo"]);

export interface MiniMarkdownOptions {
  /** When set, shell code blocks get a button that hands the command to the host terminal (see EmmyChatApp). */
  onRunInTerminal?: (command: string) => void;
}

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
    <div key={key} className="emmy2-table-wrap">
    <table>
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
    </div>
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

interface ListItem {
  ordered: boolean;
  text: string;
  indent: number;
}

interface ListGroup {
  item: ListItem;
  children: ListGroup[];
}

/**
 * Groups a flat, indent-tagged run of list items into a tree using an
 * indentation stack: each item attaches under the nearest still-open
 * ancestor with a strictly shallower indent, then opens its own level at
 * its own indent. This never drops an item just because no earlier sibling
 * happened to use that exact indent value — e.g. indent jumping straight
 * from 0 to 4 and back to 2, with no item ever previously at indent 2,
 * still nests the indent-2 item under the indent-0 item instead of vanishing
 * (a strict-equality match against open levels would silently swallow it
 * and everything after it in the list).
 */
function groupListItems(items: ListItem[]): ListGroup[] {
  const roots: ListGroup[] = [];
  const stack: { indent: number; children: ListGroup[] }[] = [{ indent: -1, children: roots }];
  for (const item of items) {
    while (stack.length > 1 && item.indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const node: ListGroup = { item, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ indent: item.indent, children: node.children });
  }
  return roots;
}

function renderListGroups(groups: ListGroup[], keyPrefix: string): ReactNode {
  const Tag = groups[0].item.ordered ? "ol" : "ul";
  return (
    <Tag key={`${keyPrefix}-list`}>
      {groups.map((group, i) => (
        <li key={`${keyPrefix}-li-${i}`}>
          {renderInline(group.item.text, `${keyPrefix}-txt-${i}`)}
          {group.children.length > 0 && renderListGroups(group.children, `${keyPrefix}-${i}`)}
        </li>
      ))}
    </Tag>
  );
}

export function renderMiniMarkdown(markdown: string, opts: MiniMarkdownOptions = {}): ReactNode {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: ListItem[] | null = null;
  let quoteLines: string[] | null = null;
  let blockKey = 0;

  const flushList = () => {
    if (!listItems) return;
    blocks.push(renderListGroups(groupListItems(listItems), `list-${blockKey++}`));
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
    const fenceMatch = /^```(\w*)/.exec(line.trim());
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
      const body = codeLines.join("\n");
      const chartSpec = lang === "chart" ? parseEmmyChartSpec(body) : null;
      if (lang === "mermaid") {
        blocks.push(<EmmyMermaid key={`mermaid-${blockKey++}`} code={body} />);
      } else if (chartSpec) {
        blocks.push(<EmmyChart key={`chart-${blockKey++}`} spec={chartSpec} />);
      } else {
        const runnable = opts.onRunInTerminal && SHELL_LANGS.has(lang) && body.trim().length > 0;
        blocks.push(
          <pre key={`code-${blockKey++}`} className={runnable ? "emmy2-code-runnable" : undefined}>
            {runnable && (
              <button
                type="button"
                className="emmy2-code-run"
                onClick={() => opts.onRunInTerminal!(body.trim())}
                title="Im Server-Terminal einfügen (Enter drückst du selbst)"
              >
                In Terminal
              </button>
            )}
            <code>{body}</code>
          </pre>,
        );
      }
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
      blocks.push(<EmmyMath key={`math-${blockKey++}`} latex={mathLines.join("\n")} />);
      continue;
    }
    if (mathInlineBlockMatch) {
      flushList();
      flushQuote();
      blocks.push(<EmmyMath key={`math-${blockKey++}`} latex={mathInlineBlockMatch[1]} />);
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
