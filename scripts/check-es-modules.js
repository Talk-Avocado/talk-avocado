#!/usr/bin/env node

// ES Module Compliance Checker (Node.js version)
// This script ensures all JavaScript/TypeScript files use ES modules

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  nc: "\x1b[0m", // No Color
};

function log(message, color = "nc") {
  console.log(`${colors[color]}${message}${colors.nc}`);
}

function findFiles(dir, extensions, excludeDirs = ["node_modules", "dist"]) {
  const files = [];

  function traverse(currentDir) {
    try {
      const items = readdirSync(currentDir);

      for (const item of items) {
        const fullPath = join(currentDir, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          if (!excludeDirs.some(exclude => fullPath.includes(exclude))) {
            traverse(fullPath);
          }
        } else if (extensions.includes(extname(item))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  traverse(dir);
  return files;
}

function checkRequireStatements() {
  log("Checking for require() statements...", "yellow");

  const jsFiles = findFiles(".", [".js", ".ts"]).filter(
    file =>
      !file.includes(".cjs") &&
      !file.includes("node_modules") &&
      !file.includes("dist") &&
      !file.includes("check-es-modules.js") &&
      !file.endsWith(".eslintrc.js") &&
      !file.endsWith(".eslintrc.cjs")
  );

  log(`Found ${jsFiles.length} JS/TS files to check`, "blue");

  const violations = [];

  for (const file of jsFiles) {
    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        if (line.includes("require(") && !line.trim().startsWith("//")) {
          // Skip lines that are part of the checker's own logic or are string literals
          if (
            line.includes("line.includes('require(')") ||
            line.includes("log('Checking for require() statements')") ||
            line.includes(
              "log(`❌ Found ${violations.length} require() statements:`)"
            ) ||
            line.includes(
              "log('   Example: const fs = require(\\'fs\\') → import { readFile } from \\'fs\\'')"
            ) ||
            line.includes("require(") && (line.includes("'require(") || line.includes('"require(')) // Skip string literals containing require
          ) {
            return;
          }

          violations.push({
            file,
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    } catch (error) {
      // Skip files we can't read
    }
  }

  if (violations.length > 0) {
    log(`❌ Found ${violations.length} require() statements:`, "red");
    violations.forEach(violation => {
      log(`  ${violation.file}:${violation.line}: ${violation.content}`, "red");
    });
    log("");
    log("💡 Convert these to import statements", "yellow");
    log(
      "   Example: const fs = require('fs') → import { readFile } from 'fs'",
      "yellow"
    );
    return false;
  }

  return true;
}

function checkModuleExports() {
  log("Checking for module.exports statements...", "yellow");

  const jsFiles = findFiles(".", [".js", ".ts"]).filter(
    file =>
      !file.includes(".cjs") &&
      !file.includes("node_modules") &&
      !file.includes("dist") &&
      !file.includes("check-es-modules.js") &&
      !file.endsWith(".eslintrc.js") &&
      !file.endsWith(".eslintrc.cjs")
  );

  const violations = [];

  for (const file of jsFiles) {
    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        if (line.includes("module.exports") && !line.trim().startsWith("//")) {
          violations.push({
            file,
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    } catch (error) {
      // Skip files we can't read
    }
  }

  if (violations.length > 0) {
    log(`❌ Found ${violations.length} module.exports statements:`, "red");
    violations.forEach(violation => {
      log(`  ${violation.file}:${violation.line}: ${violation.content}`, "red");
    });
    log("");
    log("💡 Convert these to export statements", "yellow");
    log("   Example: module.exports = { func } → export { func }", "yellow");
    return false;
  }

  return true;
}

function checkPackageJsonFiles() {
  log("Checking package.json files for ES module configuration...", "yellow");

  const packageFiles = findFiles(".", [".json"]).filter(
    file =>
      file.endsWith("package.json") &&
      !file.includes("node_modules") &&
      !file.includes("dist")
  );

  let allValid = true;

  for (const packageFile of packageFiles) {
    try {
      const content = readFileSync(packageFile, "utf8");
      const pkg = JSON.parse(content);

      if (!pkg.type || pkg.type !== "module") {
        log(`⚠️  ${packageFile} missing "type": "module"`, "yellow");
        allValid = false;
      }
    } catch (error) {
      log(`⚠️  Could not parse ${packageFile}`, "yellow");
      allValid = false;
    }
  }

  return allValid;
}

// Main execution
log("🔍 Checking ES module compliance...", "blue");

const requireCheck = checkRequireStatements();
const moduleExportsCheck = checkModuleExports();
const packageJsonCheck = checkPackageJsonFiles();

if (requireCheck && moduleExportsCheck && packageJsonCheck) {
  log("✅ All files are using ES modules!", "green");
  process.exit(0);
} else {
  log("❌ Found ES module compliance issues", "red");
  process.exit(1);
}
