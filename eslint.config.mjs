import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    /* THE ALTERNATE DIST DIRS TOO. `.gitignore` names three of these and
       records why each was added; ESLint 9's flat config does NOT read
       .gitignore, so a build run with NEXT_DIST_DIR — which is how this repo
       builds without clobbering the running dev server — leaves output ESLint
       then tries to lint. It does not merely lint it slowly: the run DIES on
       the first file Next has since cleaned up, with an ENOENT naming a
       `.js` under `.next-build/server/app`, so `npm run lint` is unusable for
       as long as the directory exists. */
    ".next-build/**",
    ".next-shot/**",
    ".next-fold/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code skill assets are templates, not application source.
    ".claude/**",
  ]),
  {
    rules: {
      // Allow intentional unused vars/args prefixed with underscore
      // (e.g. destructuring to omit a field: `({ id: _id, ...rest }) => rest`).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
