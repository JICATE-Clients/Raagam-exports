// Compile/type-check the app WITHOUT disturbing a running dev server.
// Run:  npm run build:check
//
// `next build` and `next dev` both write to `.next` by default. Running a build
// while the dev server is up leaves it serving half-overwritten artifacts — the
// browser shows stale code that matches no file on disk, which reads exactly
// like a bug that "won't fix". Here the two commands don't even share a bundler
// (`dev` = Turbopack, `build` = `--webpack` for Serwist), so the mixture is
// worse than stale: it's two toolchains' output in one directory.
//
// This points the build at `.next-verify` via NEXT_DIST_DIR, which
// next.config.ts reads. `npm run build` is unchanged and still owns `.next`.
//
// Written as a node script rather than an inline env var because `cross-env` is
// not a dependency and `NEXT_DIST_DIR=x next build` does not work in npm scripts
// on Windows, which is where this repo is developed.
import { spawn } from "node:child_process";

const DIST = ".next-verify";

console.log(`build-check → ${DIST} (leaving .next alone)\n`);

// `shell: true` so the platform resolves the `next` bin shim (next.cmd on
// Windows) without hard-coding a path into node_modules/.bin.
const child = spawn("next", ["build", "--webpack"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: DIST },
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("build-check failed to start:", err.message);
  process.exit(1);
});
