module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // Code quality rules
    'no-unused-vars': 'warn',
    'no-console': 'warn',
    'prefer-const': 'error',
    'no-var': 'error',
    'no-empty': 'warn',
    'no-duplicate-imports': 'error',
  },
  overrides: [
    {
      files: [
        'scripts/**/*.js',
        'tools/**/*.js',
      ],
      rules: {
        'no-console': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '*.min.js',
    'coverage/',
    '**/*.ts', // Ignore TypeScript files for now
    'podcast-automation/SmartCutPlanner/index.js', // Temporarily ignore due to complex indentation issues
  ],
};
