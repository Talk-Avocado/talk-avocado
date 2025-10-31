#!/usr/bin/env node
// Cross-platform test runner
// Detects the OS and runs the appropriate test script (bash or PowerShell)

import { platform } from "node:os";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const osPlatform = platform();
const isWindows = osPlatform === "win32";

let exitCode = 0;

try {
  if (isWindows) {
    // Windows: Use PowerShell script
    console.log("[test] Running tests on Windows (PowerShell)...");
    const psScript = "scripts/test.ps1";

    if (existsSync(psScript)) {
      try {
        // Try powershell first (Windows PowerShell)
        execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}"`, {
          stdio: "inherit",
          shell: true,
        });
      } catch (error) {
        // If powershell fails, try pwsh (PowerShell Core)
        try {
          execSync(`pwsh -File "${psScript}"`, {
            stdio: "inherit",
            shell: true,
          });
        } catch (psError) {
          console.error("[test] Error: Could not run PowerShell script");
          console.error("[test] Make sure PowerShell is installed");
          exitCode = 1;
        }
      }
    } else {
      console.error(
        `[test] Error: PowerShell test script not found: ${psScript}`
      );
      exitCode = 1;
    }
  } else {
    // Unix/Linux/Mac: Use bash script
    console.log("[test] Running tests on Unix/Linux/Mac (bash)...");
    const bashScript = "scripts/test.sh";

    if (existsSync(bashScript)) {
      try {
        execSync(`bash "${bashScript}"`, {
          stdio: "inherit",
          shell: true,
        });
      } catch (error) {
        console.error("[test] Error: Could not run bash script");
        exitCode = 1;
      }
    } else {
      console.error(`[test] Error: Bash test script not found: ${bashScript}`);
      exitCode = 1;
    }
  }
} catch (error) {
  console.error("[test] Unexpected error:", error.message);
  exitCode = 1;
}

process.exit(exitCode);
