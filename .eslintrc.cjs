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
<<<<<<< HEAD
    // General code quality - make less strict for now
    'no-unused-vars': 'warn',
    'no-console': 'off',
    'prefer-const': 'warn',
    'no-var': 'error',
    'no-undef': 'warn',
    'no-empty': 'warn'
  },
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      rules: {
        'no-unused-vars': 'warn'
      }
    }
  ]
};
=======
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
>>>>>>> MFU-WP01-04-BE-video-engine-cuts
