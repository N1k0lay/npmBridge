import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Предупреждать об неиспользуемых переменных (с исключением для _prefix)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Предупреждать об использовании any
      "@typescript-eslint/no-explicit-any": "warn",
      // Запрещать console.log в prod-коде (предупреждение)
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Предпочитать const
      "prefer-const": "error",
      // Без дублирующих ключей в объектах
      "no-duplicate-imports": "error",
    },
  },
];

export default eslintConfig;
