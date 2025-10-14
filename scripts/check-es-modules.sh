#!/bin/bash

# ES Module Compliance Checker
# This script ensures all JavaScript/TypeScript files use ES modules

set -e

echo "🔍 Checking ES module compliance..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for CommonJS require statements
echo "Checking for require() statements..."
REQUIRE_COUNT=$(grep -r "require(" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.cjs" . | wc -l)

if [ "$REQUIRE_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ Found $REQUIRE_COUNT require() statements:${NC}"
    grep -r "require(" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.cjs" .
    echo ""
    echo -e "${YELLOW}💡 Convert these to import statements${NC}"
    echo -e "${YELLOW}   Example: const fs = require('fs') → import { readFile } from 'fs'${NC}"
    exit 1
fi

# Check for module.exports statements
echo "Checking for module.exports statements..."
MODULE_EXPORTS_COUNT=$(grep -r "module\.exports" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.cjs" . | wc -l)

if [ "$MODULE_EXPORTS_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ Found $MODULE_EXPORTS_COUNT module.exports statements:${NC}"
    grep -r "module\.exports" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.cjs" .
    echo ""
    echo -e "${YELLOW}💡 Convert these to export statements${NC}"
    echo -e "${YELLOW}   Example: module.exports = { func } → export { func }${NC}"
    exit 1
fi

# Check package.json files for type: "module"
echo "Checking package.json files for ES module configuration..."
PACKAGE_FILES=$(find . -name "package.json" -not -path "./node_modules/*" -not -path "./dist/*")

for package_file in $PACKAGE_FILES; do
    if ! grep -q '"type": "module"' "$package_file"; then
        echo -e "${YELLOW}⚠️  $package_file missing \"type\": \"module\"${NC}"
        echo -e "${YELLOW}   Add this to ensure ES module support${NC}"
    fi
done

# Check for missing .js extensions in relative imports
echo "Checking for missing .js extensions in relative imports..."
MISSING_EXT_COUNT=$(grep -r "from ['\"]\\./" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.cjs" . | grep -v "\.js['\"]" | wc -l)

if [ "$MISSING_EXT_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $MISSING_EXT_COUNT relative imports without .js extension:${NC}"
    grep -r "from ['\"]\\./" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude="*.cjs" . | grep -v "\.js['\"]"
    echo ""
    echo -e "${YELLOW}💡 Add .js extension to relative imports${NC}"
    echo -e "${YELLOW}   Example: import { func } from './utils' → import { func } from './utils.js'${NC}"
fi

echo -e "${GREEN}✅ ES module compliance check completed${NC}"

# Summary
echo ""
echo "📊 Summary:"
echo "  - require() statements: $REQUIRE_COUNT"
echo "  - module.exports statements: $MODULE_EXPORTS_COUNT"
echo "  - Missing .js extensions: $MISSING_EXT_COUNT"

if [ "$REQUIRE_COUNT" -eq 0 ] && [ "$MODULE_EXPORTS_COUNT" -eq 0 ]; then
    echo -e "${GREEN}🎉 All files are using ES modules!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some files need to be converted to ES modules${NC}"
    exit 1
fi
