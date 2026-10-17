import js from "@eslint/js";
import globals from "globals";
import unusedImports from "eslint-plugin-unused-imports";

/** Foundry / system globals the module relies on (read-only). */
const foundryGlobals = Object.fromEntries(
  [
    "game",
    "ui",
    "canvas",
    "CONFIG",
    "CONST",
    "Hooks",
    "foundry",
    "fromUuid",
    "fromUuidSync",
    "Handlebars",
    "ChatMessage",
    "Roll",
    "Actor",
    "Combat",
    "Combatant",
    "Item",
    "Token",
    "TokenDocument",
    "Scene",
    "User",
    "Folder",
    "JournalEntry",
    "JournalEntryPage",
    "Macro",
    "RollTable",
    "Playlist",
    "ActiveEffect",
    "Application",
    "Dialog",
    "CombatTrackerConfig",
    "Sequence",
    "Sequencer",
    "libWrapper"
  ].map((n) => [n, "readonly"])
);

export default [
  { ignores: ["node_modules/**", "packs/**", "packs-src/**", "dist/**", "tools/**/*.py"] },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, ...foundryGlobals } },
    plugins: { "unused-imports": unusedImports },
    rules: {
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-undef": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "no-useless-escape": "warn",
      "no-void": "error",
      "max-len": [
        "warn",
        { code: 260, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true, ignoreRegExpLiterals: true, ignoreComments: true }
      ]
    }
  },
  {
    files: ["tools/**/*.mjs", "tests/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node, ...foundryGlobals } },
    rules: { "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }], "no-empty": ["error", { allowEmptyCatch: true }] }
  }
];
