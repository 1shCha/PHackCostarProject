// Where the app may write files. Locally that's ./cache (gitignored).
// On Vercel the project folder is read-only and only /tmp is writable (and it's wiped between cold starts),
// so caches go there; anything missing is simply fetched again.

import path from "node:path";

export const cacheRoot = () => (process.env.VERCEL ? "/tmp/cache" : path.join(process.cwd(), "cache"));
export const cacheDir = (...parts: string[]) => path.join(cacheRoot(), ...parts);
