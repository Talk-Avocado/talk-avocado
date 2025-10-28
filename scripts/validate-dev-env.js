#!/usr/bin/env node

// Developer Environment Validation Script
// Ensures consistent setup across all development machines

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

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

function checkCommand(command) {
  try {
    const result = execSync(command, { encoding: "utf8", stdio: "pipe" });
    return { success: true, result: result.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function checkFileExists(filePath, description) {
  if (existsSync(filePath)) {
    log(`✅ ${description}: ${filePath}`, "green");
    return true;
  } else {
    log(`❌ ${description}: ${filePath} not found`, "red");
    return false;
  }
}

function checkPackageJson(filePath, description) {
  try {
    const content = readFileSync(filePath, "utf8");
    const pkg = JSON.parse(content);

    if (pkg.type === "module") {
      log(`✅ ${description}: ES module configured`, "green");
      return true;
    } else {
      log(`⚠️  ${description}: Missing "type": "module"`, "yellow");
      return false;
    }
  } catch (error) {
    log(`❌ ${description}: Could not parse ${filePath}`, "red");
    return false;
  }
}

// Main validation
log("🔍 Validating developer environment...", "blue");

let allValid = true;

// Check Node.js version
log("Checking Node.js version...", "blue");
const nodeCheck = checkCommand("node --version", "Node.js version");
if (nodeCheck.success) {
  const version = nodeCheck.result;
  const majorVersion = parseInt(version.slice(1).split(".")[0]);
  if (majorVersion >= 18) {
    log(`✅ Node.js version: ${version}`, "green");
  } else {
    log(`❌ Node.js version ${version} is below required v18.0.0`, "red");
    allValid = false;
  }
} else {
  log(`❌ Node.js not found: ${nodeCheck.error}`, "red");
  allValid = false;
}

// Check npm version
log("Checking npm version...", "blue");
const npmCheck = checkCommand("npm --version", "npm version");
if (npmCheck.success) {
  log(`✅ npm version: ${npmCheck.result}`, "green");
} else {
  log(`❌ npm not found: ${npmCheck.error}`, "red");
  allValid = false;
}

// Check required global packages
log("Checking required global packages...", "blue");
const requiredPackages = ["eslint", "prettier"];
for (const pkg of requiredPackages) {
  const check = checkCommand(
    `npm list -g ${pkg}`,
    `${pkg} global installation`
  );
  if (check.success) {
    log(`✅ ${pkg} is installed globally`, "green");
  } else {
    log(`⚠️  ${pkg} is not installed globally`, "yellow");
    log(`   Run: npm install -g ${pkg}`, "yellow");
  }
}

// Check project dependencies
log("Checking project dependencies...", "blue");
if (checkFileExists("package.json", "Root package.json")) {
  if (checkCommand("npm ci", "Root dependencies installation").success) {
    log("✅ Root dependencies installed", "green");
  } else {
    log("❌ Root dependencies installation failed", "red");
    allValid = false;
  }
} else {
  log("❌ package.json not found", "red");
  allValid = false;
}

// Check backend dependencies
if (checkFileExists("backend/package.json", "Backend package.json")) {
  if (
    checkCommand("cd backend && npm ci", "Backend dependencies installation")
      .success
  ) {
    log("✅ Backend dependencies installed", "green");
  } else {
    log("❌ Backend dependencies installation failed", "red");
    allValid = false;
  }
}

// Check ESLint configuration
log("Checking ESLint configuration...", "blue");
if (checkFileExists(".eslintrc.cjs", "ESLint configuration")) {
  const eslintCheck = checkCommand(
    "npx eslint --print-config .eslintrc.cjs",
    "ESLint configuration validation"
  );
  if (eslintCheck.success) {
    log("✅ ESLint configuration is valid", "green");
  } else {
    log("❌ ESLint configuration is invalid", "red");
    allValid = false;
  }
} else {
  log("❌ .eslintrc.cjs not found", "red");
  allValid = false;
}

// Check Prettier configuration
log("Checking Prettier configuration...", "blue");
if (checkFileExists(".prettierrc", "Prettier configuration")) {
  log("✅ Prettier configuration found", "green");
} else {
  log("⚠️  Prettier configuration not found", "yellow");
  log("   Consider adding .prettierrc file", "yellow");
}

// Check package.json ES module configuration
log("Checking package.json ES module configuration...", "blue");
checkPackageJson("package.json", "Root package.json");
if (existsSync("backend/package.json")) {
  checkPackageJson("backend/package.json", "Backend package.json");
}

// Run initial linting check
log("Running initial linting check...", "blue");
const lintCheck = checkCommand("npm run lint", "ESLint check");
if (lintCheck.success) {
  log("✅ Initial linting check passed", "green");
} else {
  log("⚠️  Initial linting check found issues", "yellow");
  log('   Run "npm run lint" to see details', "yellow");
}

// Run ES module compliance check
log("Running ES module compliance check...", "blue");
const esModuleCheck = checkCommand(
  "npm run check-es-modules",
  "ES module compliance check"
);
if (esModuleCheck.success) {
  log("✅ ES module compliance check passed", "green");
} else {
  log("⚠️  ES module compliance check found issues", "yellow");
  log('   Run "npm run check-es-modules" to see details', "yellow");
}

// Final result
log("", "reset");
if (allValid) {
  log("🎉 Developer environment validation completed!", "green");
  log("Your development environment is ready for CI/CD improvements.", "blue");
  process.exit(0);
} else {
  log("❌ Developer environment validation failed", "red");
  log("Please fix the issues above before continuing.", "red");
  process.exit(1);
}
