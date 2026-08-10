import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * Formatting is Prettier's job and is not represented here — `eslint-config-prettier`
 * last in the array switches off every rule the two could argue about.
 *
 * What is here is correctness, plus the rules at the bottom, which are the invariants
 * AGENTS.md states in prose. Those are the point of running a linter on this repo at
 * all: a documented invariant that nothing checks is a comment, and the audit found
 * several that the code had quietly stopped honouring.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-site/**",
      "src-tauri/**",
      "node_modules/**",
      "eslint.config.js",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,

  // Type-aware linting. The expensive option, and the only one that can see through a
  // promise or a union — `no-floating-promises` alone justifies it here, because an
  // unobserved rejection is exactly how the dead-links bug shipped in v1.0.0.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
  },

  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // The three React Compiler rules that arrived in eslint-plugin-react-hooks v7.
      // They flag 27 real places here — refs read during render in DocumentDeck and
      // TabStrip, setState inside effects in App and DocumentView. Acting on them means
      // reshaping how the deck, the drag gesture and the measuring passes work, which is
      // a behaviour change and has no business riding along in the commit that installs
      // the linter. Off rather than "warn" so the gate stays at zero, with a follow-up
      // to turn them on one at a time. See the note in AGENTS.md.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",

      // `interface Props {}` and `type Props = {}` are both used in this codebase and
      // the distinction carries no meaning here; forcing one is churn, not clarity.
      "@typescript-eslint/consistent-type-definitions": "off",

      // `${count}` and `${width}px` are the overwhelming majority of template literals
      // here and there is nothing ambiguous about a number's string form.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],

      // Deliberately off, because `noUncheckedIndexedAccess` is on. Every array index
      // is `T | undefined`, so code that has already bounds-checked has to say `!` to
      // proceed; banning it too would mean re-deriving a proof the author just wrote.
      // The two settings are a pair — drop the tsconfig one and this should come back.
      "@typescript-eslint/no-non-null-assertion": "off",

      // Imports that exist only for their types should say so — it keeps them out of
      // the emitted graph and makes a cycle impossible to introduce by accident.
      //
      // `disallowTypeAnnotations: false` because `typeof import("mermaid").default` is
      // the only way to name the shape of a module that is *deliberately* not statically
      // imported. Forbidding it would push shiki/mermaid/katex back into a static import,
      // which is the exact thing the code-splitting invariant below exists to prevent.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],

      // An unused argument named `_something` is a deliberate signature match.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Accessibility. The rail is almost entirely icon-only controls, which is precisely
  // the case where a missing label is invisible to everyone who can see the icon.
  {
    files: ["**/*.tsx"],
    ...jsxA11y.flatConfigs.strict,
  },

  // ---------------------------------------------------------------------------
  // The invariants. Each line here corresponds to a sentence in AGENTS.md.
  // ---------------------------------------------------------------------------
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        // "It never touches the network" is on the README and is the reason the app
        // is trusted with untrusted documents. These are the ways a frontend reaches
        // the network; the CSP blocks them too, but a CSP is a runtime backstop and
        // this is the thing that fails the build.
        { name: "fetch", message: "lindo-md is offline-only — see AGENTS.md." },
        { name: "XMLHttpRequest", message: "lindo-md is offline-only — see AGENTS.md." },
        { name: "WebSocket", message: "lindo-md is offline-only — see AGENTS.md." },
        { name: "EventSource", message: "lindo-md is offline-only — see AGENTS.md." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='navigator'][callee.property.name='sendBeacon']",
          message: "lindo-md is offline-only — see AGENTS.md.",
        },
        {
          // "Shiki and Mermaid are large. Both are dynamically imported so Vite
          // code-splits them. Do not move either to a static import." A static import
          // does not fail anything — it just quietly adds ~1.4MB to the entry chunk.
          //
          // `importKind!='type'` matters: `import type { ThemeRegistrationRaw } from
          // "shiki"` is erased before bundling and is what shiki-house.ts legitimately
          // does. Without the guard this rule flags the one file that is doing it right.
          selector: "ImportDeclaration[importKind!='type'][source.value=/^(mermaid|shiki)($|\\/)/]",
          message:
            "Import mermaid/shiki dynamically — a static import undoes the code-splitting (AGENTS.md).",
        },
      ],
    },
  },

  {
    // "`ipc.ts` is the ONLY place `invoke` is called." Everything else goes through
    // its zod-parsed wrappers, which is what stops an unvalidated Rust response
    // reaching a component.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/ipc.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message: "Call invoke only in src/lib/ipc.ts — every response is zod-parsed there.",
            },
          ],
        },
      ],
    },
  },

  // `ui/` exports its shared class strings next to the primitives that use them, and a
  // hook module exports the hook beside its provider. Both are the conventional shape;
  // the cost is that Vite full-reloads that module instead of hot-swapping it, which is
  // not worth splitting two files apart to avoid.
  {
    files: ["src/components/ui/**/*.tsx", "src/hooks/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },

  // Tests reach into internals and assert on shapes the type system cannot express.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.test.mjs"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },

  // Build scripts are Node, not browser, and are plain JS.
  //
  // Two config objects, not one. `disableTypeChecked` carries its own `languageOptions`,
  // so spreading it into the same object literal replaces the `globals` set beside it —
  // which silently drops the Node globals and reports `process` as undefined.
  {
    files: ["scripts/**/*.mjs", "test/e2e/**/*.mjs", "vite.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["scripts/**/*.mjs", "test/e2e/**/*.mjs", "vite.config.ts"],
    languageOptions: { globals: globals.node },
  },

  // The landing page: browser, plain JS, and outside the TypeScript project, so
  // type-aware rules have nothing to read and error out on the file itself.
  //
  // Note what it is *not* under: the offline invariant above is scoped to
  // `src/**` and stays there. The app must never call `fetch`; the site is a web
  // page whose download button asks GitHub which version is current, and holding
  // it to the app's rule would be applying a promise about someone's documents
  // to a page that has none.
  {
    files: ["site/**/*.{js,mjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["site/**/*.{js,mjs}"],
    languageOptions: { globals: globals.browser },
  },

  prettier,
);
