import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "coverage/**", "next-env.d.ts", "infra/**", "node_modules/**", ".claude/**", ".npm-cache/**"] },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error"
    }
  },
  { files: ["scripts/**"], rules: { "no-console": "off" } }
];

export default config;
