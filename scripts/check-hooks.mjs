// A HOOK BELOW AN EARLY RETURN IS A BROKEN SCREEN, AND IT KEEPS SHIPPING.
// Run:  npm run check:hooks
//
// ## What this exists to stop
//
// `garment-order-screen.tsx` returns early — `if (mode === "list")` — and the
// same component renders the editor below that line. A hook declared under it
// therefore runs on the editor render and is skipped on the list render, and
// React counts hooks BY POSITION: crossing between the two throws "Rendered
// more hooks than during the previous render" and the whole route falls into
// `app/(app)/error.tsx`. The operator sees "This screen couldn't load".
//
// That file has now recorded the rule FIVE times in its own comments, once per
// occurrence, and 2026-09-02 is the fifth: two hooks (`sqOptions`) sat 1,300
// lines under the branch on the deployed build and took `/orders/garment-orders`
// down completely.
//
// ## Why a script rather than "remember to run eslint"
//
// ESLint already names this exactly — `react-hooks/rules-of-hooks`, "React Hook
// "useState" is called conditionally" — and has done every single time. It was
// never the DETECTION that was missing. Three things kept the answer off the
// screen:
//
//  - `next build` does not lint (Next 16 dropped it), and `npm run build:check`
//    is this repo's gate. So the gate and the check had nothing to do with each
//    other.
//  - `npm run lint` was UNUSABLE right after that gate ran: `.next-verify` — the
//    dist dir `build:check` writes — was missing from `eslint.config.mjs`'s
//    ignores, so a full lint died with ENOENT on Next's own cleaned-up output.
//    Fixed in the same change as this file; the two halves are one bug.
//  - A full-repo lint is minutes long and mostly type-aware rules, which is long
//    enough that it gets skipped under time pressure.
//
// So this runs ONE rule with no type information, in seconds, and exits
// non-zero. It is deliberately narrow: it is not a replacement for `npm run
// lint`, it is the part of it that must never be skipped.
//
// Verified by being made to FAIL first — against the deployed 2026-09-02 build
// of `garment-order-screen.tsx`, where it reported both hooks — before being
// trusted. A check nobody has seen fail is a check nobody knows the state of.
import { ESLint } from "eslint";
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

// The React surfaces. `lib/**` is in scope because custom hooks live there
// (`lib/focus.ts`'s callers, `use-create-intent.ts`, `use-duplicate-check.ts`),
// and a conditional hook inside one breaks its caller rather than itself.
const TARGETS = ["app", "components", "lib", "hooks"];

const eslint = new ESLint({
  // `true` = ignore eslint.config.mjs entirely. Not a snub: loading it pulls in
  // eslint-config-next's type-aware rules, which is the minutes this exists to
  // avoid. The rule below needs no program and no tsconfig.
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.{ts,tsx,js,jsx,mjs}"],
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: { "react-hooks": reactHooks },
      rules: { "react-hooks/rules-of-hooks": "error" },
    },
  ],
  // The build dirs. `eslint.config.mjs` is not read at all here, so its
  // globalIgnores do not apply and these have to be restated.
  ignorePatterns: [
    ".next/**",
    ".next-verify/**",
    ".next-build/**",
    ".next-shot/**",
    ".next-fold/**",
    "out/**",
    "build/**",
    "node_modules/**",
    ".claude/**",
  ],
  errorOnUnmatchedPattern: false,
});

const RULE = "react-hooks/rules-of-hooks";

const results = await eslint.lintFiles(TARGETS);
/* FILTERED BY `ruleId`, NOT BY `errorCount`.
   `errorCount` also counts "Definition for rule '@next/next/no-img-element'
   was not found" — five files carry an `eslint-disable` comment naming a rule
   this stripped-down config does not load, and ESLint reports an unknown rule
   in a disable directive as an error of its own. Those are correct files with
   a correct suppression; reporting them here would make the check cry wolf on
   its first run, which is how a gate stops being read. */
const offenders = results
  .map((r) => ({ ...r, messages: r.messages.filter((m) => m.ruleId === RULE) }))
  .filter((r) => r.messages.length > 0);

if (offenders.length === 0) {
  const n = results.length;
  console.log(`check:hooks — 0 conditional hooks across ${n} files.`);
  process.exit(0);
}

console.error("check:hooks FAILED — a hook is called conditionally.\n");
console.error(
  "React counts hooks by position, so the component crashes the moment it\n" +
    "renders down the other branch. Move the hook ABOVE every early return;\n" +
    "if it only memoises a cheap pass, drop the memo and make it a plain const.\n",
);
for (const r of offenders) {
  const rel = r.filePath.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "");
  for (const m of r.messages) {
    console.error(`  ${rel}:${m.line}:${m.column}  ${m.message}`);
  }
}
console.error(`\n${offenders.length} file(s).`);
process.exit(1);
