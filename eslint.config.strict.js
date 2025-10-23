import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import promisePlugin from "eslint-plugin-promise";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import unusedImports from "eslint-plugin-unused-imports";
import localPlugin from "./eslint-plugin-local/index.js";
import globals from "globals";

export default [
  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/dist-test/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.expo/**",
      "test-all-features.*",
      "debug-*.js",
      "check_*.js",
      "test_*.js",
    ],
  },

  // JavaScript files - basic rules (no type-aware checking)
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {
      js,
      import: importPlugin,
      promise: promisePlugin,
      sonarjs,
      unicorn,
      "unused-imports": unusedImports,
    },
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      ...js.configs.recommended.rules,
      ...promisePlugin.configs.recommended.rules,
      ...sonarjs.configs.recommended.rules,

      // Variable hygiene
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "error",

      // Promise hygiene
      "promise/always-return": "error",
      "promise/catch-or-return": "error",
      "promise/param-names": "error",

      // Import hygiene
      "unused-imports/no-unused-imports": "error",
      "import/no-unresolved": "off", // TS handles this

      // Unicorn best practices (selective)
      "unicorn/no-null": "off", // Allow null in TS
      "unicorn/prevent-abbreviations": "off", // Too aggressive
      "unicorn/no-array-reduce": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/prefer-top-level-await": "off",
    },
  },

  // TypeScript files - MAXIMUM STRICTNESS with type-aware linting
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@typescript-eslint": typescript,
      import: importPlugin,
      promise: promisePlugin,
      sonarjs,
      unicorn,
      "unused-imports": unusedImports,
      local: localPlugin,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: ["./tsconfig.json"],
        tsconfigRootDir: process.cwd(),
      },
      globals: globals.node,
    },
    rules: {
      // Disable base rules in favor of TypeScript equivalents
      "no-unused-vars": "off",
      "no-use-before-define": "off",
      "no-shadow": "off",
      "no-throw-literal": "off",
      "no-implied-eval": "off",
      "require-await": "off",
      "no-return-await": "off",

      // === CORE UNSAFE WALLS ===
      // These catch the most dangerous type-safety violations
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",

      // === TYPE SOUNDNESS ===
      "@typescript-eslint/no-explicit-any": ["error", { fixToUnknown: true, ignoreRestArgs: false }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "as",
          objectLiteralTypeAssertions: "never",
        },
      ],

      // === CUSTOM RULES ===
      "local/no-double-assert": "error", // Ban `as unknown as T`

      // === ARITHMETIC & TEMPLATE SAFETY ===
      "@typescript-eslint/restrict-plus-operands": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowBoolean: false, allowAny: false, allowNullish: false }],

      // === PROMISE SAFETY ===
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false, ignoreIIFE: false }],
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: { attributes: false, properties: true, returns: true, variables: true },
          checksConditionals: true,
        },
      ],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: false }],
      "@typescript-eslint/promise-function-async": "error",

      // === ERROR HANDLING ===
      "@typescript-eslint/only-throw-error": "error",

      // === ENUM SAFETY ===
      "@typescript-eslint/no-unsafe-enum-comparison": "error",

      // === STRICTNESS ===
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-unnecessary-condition": ["error", { allowConstantLoopConditions: true }],
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/prefer-reduce-type-parameter": "error",
      "@typescript-eslint/prefer-return-this-type": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",
      "@typescript-eslint/prefer-includes": "error",

      // === NAMING & STYLE ===
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "variable", types: ["boolean"], format: ["PascalCase"], prefix: ["is", "has", "should", "can", "did", "will"] },
      ],

      // === IMPORT HYGIENE ===
      "unused-imports/no-unused-imports": "error",
      "import/no-unresolved": "off",
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "always",
          alphabetize: { order: "asc" },
        },
      ],

      // === PROMISE & SONARJS ===
      ...promisePlugin.configs.recommended.rules,
      ...sonarjs.configs.recommended.rules,
      "sonarjs/cognitive-complexity": ["error", 15],
      "sonarjs/no-duplicate-string": "off", // Too noisy

      // === UNICORN (selective) ===
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/no-useless-undefined": "off",
    },
  },

  // Test files - slightly relaxed rules
  {
    files: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test/**", "**/tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "local/no-double-assert": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
    },
  },
];
