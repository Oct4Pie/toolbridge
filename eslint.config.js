import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import nodePlugin from "eslint-plugin-node";
import promisePlugin from "eslint-plugin-promise";
import globals from "globals";

export default [
  // Ignore build artifacts and subproject node_modules/ui to reduce noise
  {
    ignores: [
      "dist/**",
      "dist-test/**",
      "node_modules/**",
      "test-all-features.*", // Not in tsconfig.json project
    ],
  },
  // JavaScript files configuration
  {
    files: ["**/*.{js,mjs,cjs}"],
    ignores: ["eslint.config.js"], // Exclude ESLint config from import resolution checks
    plugins: {
      js,
      import: importPlugin,
      node: nodePlugin,
      promise: promisePlugin,
    },
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      ...js.configs.recommended.rules,

      // Strict variable rules
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-var": "error",
      "prefer-const": "error",
      "no-redeclare": "error",

      // Error handling - allow console in main server file
      "no-console": "warn",
      "no-debugger": "error",
      "no-alert": "error",

      // Best practices
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-return-assign": "error",
      "no-sequences": "error",
      "no-throw-literal": "error",
      "no-unmodified-loop-condition": "error",
      "no-unused-expressions": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-useless-return": "error",
      "prefer-promise-reject-errors": "error",
      "require-await": "error",

      // Import rules
      "import/no-unresolved": "error",
      "import/named": "error",
      "import/default": "error",
      "import/no-absolute-path": "error",
      "import/no-self-import": "error",
      "import/no-cycle": "error",
      "import/no-useless-path-segments": "error",
      "import/no-deprecated": "warn",

      // Node.js rules
      "node/no-missing-import": "off", // Handled by TypeScript
      "node/no-unsupported-features/es-syntax": "off", // We use ES modules

      // Promise rules
      "promise/always-return": "error",
      "promise/catch-or-return": "error",
      "promise/param-names": "error",
      "promise/no-return-wrap": "error",
    },
  },

  // TypeScript files configuration - ULTRA STRICT
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@typescript-eslint": typescript,
      import: importPlugin,
      node: nodePlugin,
      promise: promisePlugin,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: [
          "./tsconfig.json",

        ],
        tsconfigRootDir: process.cwd(),
      },
      globals: globals.node,
    },
    rules: {
      // Base ESLint rules (disabled in favor of TypeScript versions)
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "no-shadow": "off",
      "no-use-before-define": "off",
      "no-useless-constructor": "off",
      "no-empty-function": "off",
      "no-array-constructor": "off",
      "no-loss-of-precision": "off",
      "no-loop-func": "off",
      "no-magic-numbers": "off",

      // TypeScript-specific STRICT rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",

      // Type checking - relax some strictness to prioritize high-impact fixes
      "@typescript-eslint/strict-boolean-expressions": "off", // Too strict for practical use
      "@typescript-eslint/no-unnecessary-condition": "off", // Can conflict with defensive programming
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "off", // Can be overly strict
      "@typescript-eslint/no-unnecessary-type-constraint": "error",

      // Function rules
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/no-misused-promises": ["error", {
        checksConditionals: true,
        checksVoidReturn: true,
      }],
      "@typescript-eslint/require-await": "off", // Too strict for utility functions
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/promise-function-async": "off", // Too opinionated

      // Variable and naming
      "@typescript-eslint/no-redeclare": "error",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-use-before-define": "error",
      "@typescript-eslint/no-useless-constructor": "error",
      "@typescript-eslint/prefer-readonly": "off", // Can be overly strict
      "@typescript-eslint/prefer-readonly-parameter-types": "off", // Too strict for Express

      // Array and object rules  
      "@typescript-eslint/no-array-constructor": "error",
      "@typescript-eslint/prefer-for-of": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",
      "@typescript-eslint/prefer-reduce-type-parameter": "error",

      // Class rules
      "@typescript-eslint/no-useless-empty-export": "error",
      "@typescript-eslint/no-extraneous-class": "error",

      // Import and module rules
      "@typescript-eslint/consistent-type-imports": ["error", {
        prefer: "type-imports",
        disallowTypeAnnotations: false,
      }],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",

      // Formatting and style - removed as these rules are deprecated

      // Error handling
      "no-console": "off", // Allow console in all files
      "no-debugger": "error",
      "no-alert": "error",

      // Best practices
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-return-assign": "error",
      "no-sequences": "error",
      "no-throw-literal": "error",
      "no-unmodified-loop-condition": "error",
      "no-unused-expressions": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-useless-return": "error",
      "prefer-promise-reject-errors": "error",

      // Import rules for TypeScript
      "import/no-unresolved": "off", // TypeScript handles module resolution
      "import/named": "off", // TypeScript handles this
      "import/default": "off", // TypeScript handles this
      "import/no-absolute-path": "error",
      "import/no-self-import": "error",
      "import/no-cycle": "error",
      "import/no-useless-path-segments": "error",
      "import/no-deprecated": "warn",
      "import/order": ["error", {
        groups: [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index",
          "type"
        ],
        "newlines-between": "always",
        alphabetize: { order: "asc", caseInsensitive: true },
      }],

      // Promise rules
      "promise/always-return": "error",
      "promise/catch-or-return": "error",
      "promise/param-names": "error",
      "promise/no-return-wrap": "error",
    },
  },

  // Test files - slightly relaxed rules
  {
    files: ["**/*.test.{ts,js}", "**/test/**/*.{ts,js}", "**/tests/**/*.{ts,js}"],
    plugins: {
      "@typescript-eslint": typescript,
      import: importPlugin,
      node: nodePlugin,
      promise: promisePlugin,
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
        tsconfigRootDir: process.cwd(),
      },
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-expressions": "off", // Chai expressions
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/promise-function-async": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "promise/always-return": "off",
      "promise/param-names": "off",
      "curly": "off",
      "no-console": "off",
      // Base ESLint rule must also be disabled for test files so Chai-style
      // assertions like `expect(...).to.be.true` don't trigger errors.
      "no-unused-expressions": "off",
    },
  },
];
