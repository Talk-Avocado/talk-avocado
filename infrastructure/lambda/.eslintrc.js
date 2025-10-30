module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    "no-console": "off", // Allow console statements for CLI tools
    "no-unused-vars": "warn",
    "no-constant-condition": "error",
  },
  ignorePatterns: ["cdk.out/**", "node_modules/**", "*.d.ts"],
};
