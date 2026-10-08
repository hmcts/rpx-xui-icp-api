import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  { ignores: ["**/.*", "dist/**", "coverage/**", "**/*.d.ts", "**/*.cjs"] },
  {
    files: ["**/*.{js,jsx,ts,tsx}", "eslint.config.mjs"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, Atomics: "readonly", SharedArrayBuffer: "readonly" },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      ...js.configs.recommended.rules,
      // Keep the existing rule scope during the ESLint migration.
      "no-useless-assignment": "off",
      "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
      "@stylistic/linebreak-style": ["error", "unix"],
      "@stylistic/quotes": ["error", "double"],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/semi": ["error", "always"],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs["eslint-recommended"].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-require-imports": "off",
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      // Chai property assertions intentionally use expressions without calls.
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
];
