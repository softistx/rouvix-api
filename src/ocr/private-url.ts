import { isIP } from "node:net";

const privateV4 = (address: string) => {
  const [a = -1, b = -1] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const privateV6 = (address: string) => {
  const lower = address.toLowerCase();
  return lower === "::1" || /^f[cd][0-9a-f]{2}:/.test(lower);
};

// Whether `url` names a service on this machine or its private network, never
// one across the internet: http(s) to `localhost`, a loopback or private
// address (IPv4 10/8, 172.16/12, 192.168/16, 127/8; IPv6 ::1, fc00::/7), or a
// single-label host (a container name on the compose network). An ID
// document's photo goes to such a service only (AGENTS.md: "ID documents never
// leave the VPS").
export function isPrivateServiceUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;
  const family = isIP(host);
  if (family === 4) return privateV4(host);
  if (family === 6) return privateV6(host);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(host);
}
