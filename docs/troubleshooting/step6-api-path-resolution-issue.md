# Step 6 API Path Resolution Issue on Windows

## Problem

When testing Step 6 (GET job via API), the server returns "Job not found" even though the manifest file exists on disk and Step 5 verified it successfully.

## Root Cause

The issue is a **working directory mismatch** combined with **path resolution**:

### The Problem Flow:

1. **PowerShell Script Changes Directory**:
   ```powershell
   Set-Location $backendDir  # Changes to D:\talk-avocado\backend
   npx tsx watch lib/server.ts  # Server runs from backend/ directory
   ```

2. **storageRoot() Uses Relative Path**:
   ```typescript
   const root = process.env.MEDIA_STORAGE_PATH || "./storage";
   return path.resolve(root);
   ```

3. **Path Resolution Issue**:
   - If `MEDIA_STORAGE_PATH` is **not set** or **not inherited** by the Node.js process
   - It defaults to `"./storage"`
   - `path.resolve("./storage")` resolves **relative to current working directory**
   - Since server runs from `backend/`, it resolves to: `D:\talk-avocado\backend\storage`
   - But manifest files are at: `D:\talk-avocado\storage\dev\...`

4. **Result**: Server looks in wrong location → "Job not found"

### Why Environment Variables Might Not Be Inherited:

- Environment variables set in PowerShell with `$env:VAR = value` are session-scoped
- When `npx tsx` spawns a child process, it should inherit them, but:
  - On Windows, there can be issues with environment variable inheritance
  - The process might have a different environment context
  - Working directory changes can affect path resolution

## Solution

### Fix 1: Ensure Environment Variables Are Set (Already Done)

The `start-api-server.ps1` script now:
- Sets `MEDIA_STORAGE_PATH` as an **absolute path** before running the server
- Re-sets environment variables just before starting `tsx` to ensure they're available
- Displays the environment variables so you can verify they're set

### Fix 2: Added Warning for Debugging

Added a warning in `storageRoot()` that detects when:
- Running on Windows
- `MEDIA_STORAGE_PATH` is not set
- Resolved path contains `backend/storage` (wrong location)

This helps identify the issue immediately.

### Fix 3: Verification Steps

To verify the fix works:

1. **Check environment variables are set**:
   ```powershell
   # In the API server window, the script should show:
   TALKAVOCADO_ENV = dev
   MEDIA_STORAGE_PATH = D:\talk-avocado\storage
   ```

2. **Test the path resolution**:
   Create a test script that calls `storageRoot()` from the server context to verify it resolves correctly.

## Prevention

1. **Always set MEDIA_STORAGE_PATH as absolute path** (not relative)
2. **Verify environment variables in the running process** (the script now displays them)
3. **Use the PowerShell script** (`start-api-server.ps1`) which handles this correctly
4. **Monitor console warnings** for path resolution issues

## Testing

After restarting the server with the fixed script, test Step 6:

```powershell
curl.exe "http://localhost:3000/jobs/{jobId}?tenantId=demo-tenant"
```

If it still fails, check:
1. Are environment variables displayed correctly when server starts?
2. Is there a warning message about path resolution?
3. Does the resolved path contain `backend/storage`?

## Alternative Workaround

If environment variables still don't work, you can:

1. **Use setx to set system-wide** (requires new terminal):
   ```powershell
   setx MEDIA_STORAGE_PATH "D:\talk-avocado\storage"
   setx TALKAVOCADO_ENV "dev"
   # Then restart server in NEW terminal
   ```

2. **Create a .env file** (if the server supports it):
   ```env
   MEDIA_STORAGE_PATH=D:\talk-avocado\storage
   TALKAVOCADO_ENV=dev
   ```

## Status

- ✅ **Root cause identified**: Working directory + path resolution mismatch
- ✅ **Fix implemented**: PowerShell script ensures absolute paths and re-sets env vars
- ✅ **Debugging added**: Warning message detects wrong path resolution
- ⏳ **Testing needed**: Restart server and verify Step 6 works










