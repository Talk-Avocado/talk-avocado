# ES Module Implementation Guidelines

## Overview

All new implementations in the TalkAvocado project **MUST** use ES modules. This document provides guidelines, examples, and enforcement mechanisms to ensure consistent ES module usage across the entire codebase.

## Why ES Modules?

- **Modern Standard**: Official JavaScript module system
- **Better Performance**: Tree shaking reduces bundle sizes
- **AWS Lambda Optimized**: Native support in Node.js 18+
- **TypeScript Integration**: Seamless with our TypeScript backend
- **Future-Proof**: Industry standard for modern JavaScript

## Implementation Rules

### 1. Package.json Configuration

**ALWAYS** set `"type": "module"` in package.json:

```json
{
  "name": "your-service",
  "type": "module",
  "main": "index.js"
}
```

### 2. Import/Export Syntax

**✅ CORRECT - Use ES Module syntax:**

```javascript
// Importing
import { createReadStream } from 'fs';
import { S3Client } from '@aws-sdk/client-s3';
import { logger } from './logging.js';

// Default imports
import express from 'express';
import config from './config.js';

// Named exports
export const processVideo = async (input) => {
  // implementation
};

// Default export
export default class VideoProcessor {
  // implementation
}
```

**❌ INCORRECT - Never use CommonJS:**

```javascript
// DON'T USE
const fs = require('fs');
const { S3Client } = require('@aws-sdk/client-s3');
module.exports = { processVideo };
```

### 3. File Extensions

**ALWAYS** include `.js` extension in imports:

```javascript
// ✅ CORRECT
import { logger } from './logging.js';
import config from '../config.js';

// ❌ INCORRECT
import { logger } from './logging';
import config from '../config';
```

### 4. AWS Lambda Handlers

**ES Module Lambda handler example:**

```javascript
import { logger } from './logging.js';
import { processVideo } from './video-processor.js';

export const handler = async (event, context) => {
  logger.info('Processing video', { event });
  
  try {
    const result = await processVideo(event);
    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (error) {
    logger.error('Video processing failed', { error });
    throw error;
  }
};
```

### 5. TypeScript Integration

**TypeScript with ES modules:**

```typescript
// types.ts
export interface VideoConfig {
  inputPath: string;
  outputPath: string;
}

// processor.ts
import type { VideoConfig } from './types.js';
import { logger } from './logging.js';

export const processVideo = async (config: VideoConfig): Promise<void> => {
  logger.info('Processing video', { config });
  // implementation
};
```

## Migration Checklist

When converting existing CommonJS code:

- [ ] Update package.json: `"type": "module"`
- [ ] Convert `require()` to `import`
- [ ] Convert `module.exports` to `export`
- [ ] Add `.js` extensions to relative imports
- [ ] Update any dynamic imports
- [ ] Test thoroughly

## Common Patterns

### 1. Service Handler Pattern

```javascript
// handler.js
import { logger } from './logging.js';
import { validateInput } from './validation.js';
import { processRequest } from './processor.js';

export const handler = async (event, context) => {
  const correlationId = context.awsRequestId;
  
  try {
    logger.info('Service started', { correlationId, event });
    
    const validatedInput = await validateInput(event);
    const result = await processRequest(validatedInput);
    
    logger.info('Service completed', { correlationId, result });
    return result;
  } catch (error) {
    logger.error('Service failed', { correlationId, error });
    throw error;
  }
};
```

### 2. Utility Module Pattern

```javascript
// utils.js
import { readFile } from 'fs/promises';
import { join } from 'path';

export const loadConfig = async (configPath) => {
  const fullPath = join(process.cwd(), configPath);
  const content = await readFile(fullPath, 'utf-8');
  return JSON.parse(content);
};

export const validateSchema = (data, schema) => {
  // validation logic
  return true;
};
```

### 3. Class-based Module Pattern

```javascript
// video-processor.js
import { logger } from './logging.js';
import { S3Client } from '@aws-sdk/client-s3';

export class VideoProcessor {
  constructor(config) {
    this.config = config;
    this.s3Client = new S3Client({ region: config.region });
  }

  async process(inputPath, outputPath) {
    logger.info('Processing video', { inputPath, outputPath });
    // processing logic
  }
}

export default VideoProcessor;
```

## Enforcement Mechanisms

### 1. ESLint Configuration

Add to your ESLint config:

```json
{
  "rules": {
    "no-require": "error",
    "no-module-exports": "error"
  }
}
```

### 2. Pre-commit Hooks

Add to your pre-commit hooks:

```bash
# Check for CommonJS usage
grep -r "require(" --include="*.js" --include="*.ts" . && exit 1
grep -r "module.exports" --include="*.js" --include="*.ts" . && exit 1
```

### 3. CI/CD Checks

Add to your CI pipeline:

```yaml
- name: Check ES Module Usage
  run: |
    if grep -r "require(" --include="*.js" --include="*.ts" .; then
      echo "❌ Found CommonJS require() statements"
      exit 1
    fi
    if grep -r "module.exports" --include="*.js" --include="*.ts" .; then
      echo "❌ Found CommonJS module.exports statements"
      exit 1
    fi
    echo "✅ All files use ES modules"
```

## Troubleshooting

### Common Issues

1. **"Cannot use import statement outside a module"**
   - Solution: Ensure `"type": "module"` in package.json

2. **"Cannot resolve module"**
   - Solution: Add `.js` extension to relative imports

3. **"require is not defined"**
   - Solution: Convert to `import` statement

4. **"module is not defined"**
   - Solution: Convert to `export` statement

### Migration Examples

**Before (CommonJS):**

```javascript
const fs = require('fs');
const { logger } = require('./logging');

const processFile = (path) => {
  const content = fs.readFileSync(path, 'utf-8');
  logger.info('File processed', { path });
  return content;
};

module.exports = { processFile };
```

**After (ES Modules):**

```javascript
import { readFileSync } from 'fs';
import { logger } from './logging.js';

export const processFile = (path) => {
  const content = readFileSync(path, 'utf-8');
  logger.info('File processed', { path });
  return content;
};
```

## Review Checklist

Before submitting any new implementation:

- [ ] Package.json has `"type": "module"`
- [ ] All imports use ES module syntax
- [ ] All exports use ES module syntax
- [ ] Relative imports include `.js` extension
- [ ] No `require()` statements
- [ ] No `module.exports` statements
- [ ] Tests pass with ES modules
- [ ] Documentation updated if needed

## Questions?

- Check existing ES module implementations in `backend/`
- Review this guide for patterns
- Ask in team channels for clarification
- Create issues for edge cases not covered here
