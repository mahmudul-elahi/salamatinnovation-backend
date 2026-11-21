// Order matters: Edge and Opera include "Chrome", and Chrome includes "Safari".
const BROWSERS: [RegExp, string][] = [
  [/EdgA?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

// Common non-browser clients, matched on the whole user agent.
const CLIENTS: [RegExp, string][] = [
  [/PostmanRuntime/, 'Postman'],
  [/insomnia/i, 'Insomnia'],
  [/^curl\//, 'curl'],
  [/okhttp/i, 'Android app'],
  [/CFNetwork|Darwin/, 'iOS app'],
];

const match = (ua: string, table: [RegExp, string][]) =>
  table.find(([pattern]) => pattern.test(ua))?.[1];

/**
 * A short, human-readable device label for the session list, such as
 * "Chrome on Windows" or "Safari on iPhone". Returns null when nothing useful
 * can be read from the user agent.
 */
export function describeDevice(userAgent: string | null | undefined) {
  const ua = userAgent?.trim();
  if (!ua) return null;

  const browser = match(ua, BROWSERS);
  const system = match(ua, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;

  return match(ua, CLIENTS) ?? browser ?? system ?? null;
}
