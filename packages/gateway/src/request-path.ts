/**
 * The path of a request as it arrived, and as the application may read it: decoded, repeated
 * slashes collapsed, dot segments resolved, backslashes as slashes. `/api/%61dmin` and
 * `//api/./admin` reach the same controller as `/api/admin`, so a rule has to see that path too.
 */
export function pathVariants(url: string): { raw: string; normalised: string } {
  const raw = url.split('?', 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const collapsed = decoded.replace(/[\\/]+/g, '/');
  return { raw, normalised: new URL(collapsed, 'http://gate').pathname };
}
