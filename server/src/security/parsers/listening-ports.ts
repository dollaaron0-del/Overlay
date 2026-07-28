import type { Finding } from "@overlay/shared";

interface ListenLine {
  proto: string;
  localAddress: string;
  localPort: string;
  process?: string;
}

function parseLocalAddress(field: string): { host: string; port: string } | null {
  const bracketMatch = /^\[(.+)\]:(\d+)$/.exec(field);
  if (bracketMatch) return { host: bracketMatch[1], port: bracketMatch[2] };
  const simpleMatch = /^(.*):(\d+)$/.exec(field);
  if (simpleMatch) return { host: simpleMatch[1], port: simpleMatch[2] };
  return null;
}

function extractProcessName(line: string): string | undefined {
  const match = /users:\(\("([^"]+)"/.exec(line);
  return match?.[1];
}

function parseListenLines(ssOutput: string): ListenLine[] {
  const lines: ListenLine[] = [];
  for (const rawLine of ssOutput.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Netid")) continue;

    const fields = line.split(/\s+/);
    const [proto, state, , , localAddrPort] = fields;
    if (!proto || !localAddrPort) continue;
    const isListening = (proto === "tcp" && state === "LISTEN") || (proto === "udp" && state === "UNCONN");
    if (!isListening) continue;

    const parsedAddr = parseLocalAddress(localAddrPort);
    if (!parsedAddr) continue;

    lines.push({
      proto,
      localAddress: parsedAddr.host,
      localPort: parsedAddr.port,
      process: extractProcessName(line),
    });
  }
  return lines;
}

function isAllowedHost(host: string, allowedHosts: string[]): boolean {
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") return true;
  return allowedHosts.includes(host);
}

/**
 * Parses `ss -tulpn` output and flags any listening socket that isn't bound
 * to loopback or one of the explicitly allowed hosts (the Tailscale bind
 * address, typically) — a nightly check that the "only reachable via
 * Tailscale" network model documented in SECURITY.md actually holds, instead
 * of just being assumed.
 */
export function parseListeningPorts(ssOutput: string, allowedHosts: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const { proto, localAddress, localPort, process: proc } of parseListenLines(ssOutput)) {
    if (isAllowedHost(localAddress, allowedHosts)) continue;
    const processInfo = proc ? ` (${proc})` : "";
    findings.push({
      severity: "high",
      message: `Unerwarteter ${proto.toUpperCase()}-Listener auf ${localAddress}:${localPort}${processInfo}`,
      context: `${localAddress}:${localPort}`,
    });
  }
  return findings;
}
