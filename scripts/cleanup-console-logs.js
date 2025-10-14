#!/usr/bin/env node

// Script to clean up console.log statements across the codebase
// Replaces console.log with proper logging where appropriate

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  nc: '\x1b[0m'
};

function log(message, color = 'nc') {
  // eslint-disable-next-line no-console
  console.log(`${colors[color]}${message}${colors.nc}`);
}

function findFiles(dir, extensions, excludeDirs = ['node_modules', 'dist', '.git']) {
  const files = [];
  function traverse(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (excludeDirs.some(excludeDir => fullPath.includes(excludeDir))) {
        continue;
      }
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (extensions.includes(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  traverse(dir);
  return files;
}

function cleanupConsoleLogs(filePath) {
  try {
    let content = readFileSync(filePath, 'utf8');
    let modified = false;
    const changes = [];

    // Skip if already has logger import
    if (content.includes('import { logger }') || content.includes('from "../../scripts/logger.js"')) {
      return { modified: false, changes: [] };
    }

    // Add logger import if not present
    if (content.includes('console.log') || content.includes('console.error') || content.includes('console.warn')) {
      // Find the last import statement
      const importLines = content.split('\n').filter(line => line.trim().startsWith('import '));
      if (importLines.length > 0) {
        const lastImportIndex = content.lastIndexOf(importLines[importLines.length - 1]);
        const insertIndex = content.indexOf('\n', lastImportIndex) + 1;
        
        // Determine relative path to logger
        const depth = filePath.split('/').length - 1;
        const loggerPath = '../'.repeat(depth) + 'scripts/logger.js';
        
        content = content.slice(0, insertIndex) + `import { logger } from "${loggerPath}";\n` + content.slice(insertIndex);
        modified = true;
        changes.push('Added logger import');
      }
    }

    // Replace console.log with logger.info (for development/debug info)
    const consoleLogRegex = /console\.log\(/g;
    const consoleLogMatches = content.match(consoleLogRegex);
    if (consoleLogMatches) {
      content = content.replace(/console\.log\(/g, 'logger.info(');
      modified = true;
      changes.push(`Replaced ${consoleLogMatches.length} console.log with logger.info`);
    }

    // Replace console.error with logger.error
    const consoleErrorRegex = /console\.error\(/g;
    const consoleErrorMatches = content.match(consoleErrorRegex);
    if (consoleErrorMatches) {
      content = content.replace(/console\.error\(/g, 'logger.error(');
      modified = true;
      changes.push(`Replaced ${consoleErrorMatches.length} console.error with logger.error`);
    }

    // Replace console.warn with logger.warn
    const consoleWarnRegex = /console\.warn\(/g;
    const consoleWarnMatches = content.match(consoleWarnRegex);
    if (consoleWarnMatches) {
      content = content.replace(/console\.warn\(/g, 'logger.warn(');
      modified = true;
      changes.push(`Replaced ${consoleWarnMatches.length} console.warn with logger.warn`);
    }

    if (modified) {
      writeFileSync(filePath, content, 'utf8');
    }

    return { modified, changes };
  } catch (error) {
    log(`Error processing ${filePath}: ${error.message}`, 'red');
    return { modified: false, changes: [], error: error.message };
  }
}

function main() {
  log('🧹 Cleaning up console.log statements...', 'blue');
  
  const jsFiles = findFiles('.', ['.js']).filter(file => 
    !file.includes('node_modules') &&
    !file.includes('dist') &&
    !file.includes('.git') &&
    !file.includes('scripts/cleanup-console-logs.js') &&
    !file.includes('scripts/logger.js') &&
    !file.includes('scripts/check-es-modules.js') &&
    !file.includes('scripts/validate-dev-env.js')
  );

  let totalModified = 0;
  let totalChanges = 0;

  for (const file of jsFiles) {
    const result = cleanupConsoleLogs(file);
    if (result.modified) {
      totalModified++;
      totalChanges += result.changes.length;
      log(`✅ ${file}`, 'green');
      result.changes.forEach(change => log(`   - ${change}`, 'yellow'));
    }
  }

  log(`\n📊 Summary:`, 'blue');
  log(`   Files modified: ${totalModified}`, 'green');
  log(`   Total changes: ${totalChanges}`, 'green');
  
  if (totalModified > 0) {
    log('\n💡 Next steps:', 'yellow');
    log('   1. Run "npm run lint" to check for any issues', 'yellow');
    log('   2. Test the modified files to ensure they work correctly', 'yellow');
    log('   3. Consider removing remaining console.log in test files if not needed', 'yellow');
  } else {
    log('\n✨ No files needed console.log cleanup!', 'green');
  }
}

main();
