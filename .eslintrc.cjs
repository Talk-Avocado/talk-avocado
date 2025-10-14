module.exports = {
  env: {
    node: true,
    es2022: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    // General code quality
    'no-unused-vars': 'warn',
    'no-console': 'warn',
    'prefer-const': 'warn',
    'no-var': 'error',
    'no-empty': 'warn',
    'no-undef': 'error'
  },
  ignorePatterns: [
    '**/*.ts',
    '**/*.d.ts',
    'backend/dist/**',
    'node_modules/**'
  ]
};