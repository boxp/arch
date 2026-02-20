#!/bin/bash
# OpenClaw Issue #10640: Tool call ID too long fix
# Target: OpenClaw 2026.2.19 - Remove when fixed upstream
# See: https://github.com/openclaw/openclaw/issues/10640
#
# This script patches the compiled JavaScript to enable tool call ID
# sanitization for OpenAI providers, fixing the "string too long" error.
#
# Modifications:
# A. transcript-policy.ts: Enable sanitizeToolCallIds for OpenAI
# B. images.ts: Decouple ID sanitization from sanitizeMode

set -euo pipefail

DIST_DIR="/app/dist"
PATCH_APPLIED=0

echo "Applying tool call ID sanitization fix (issue #10640)..."

# Find all JS files recursively (includes plugin-sdk subdirectory)
find "$DIST_DIR" -name "*.js" -type f | while read -r file; do
    if grep -q 'sanitizeToolCallIds' "$file"; then
        echo "Processing: $file"

        # Fix A: !isOpenAi && sanitizeToolCallIds -> sanitizeToolCallIds
        # (removes the OpenAI exclusion from sanitization)
        # Note: The compiled code has spaces around &&
        if grep -q '!isOpenAi && sanitizeToolCallIds' "$file"; then
            sed -i 's/!isOpenAi && sanitizeToolCallIds/sanitizeToolCallIds/g' "$file"
            echo "  Applied fix A: Removed OpenAI exclusion from sanitizeToolCallIds"
            echo "1" > /tmp/patch_applied
        fi

        # Fix B: allowNonImageSanitization && options?.sanitizeToolCallIds -> options?.sanitizeToolCallIds
        # (decouples ID sanitization from sanitizeMode)
        # Note: The compiled code has spaces around &&
        if grep -q 'allowNonImageSanitization && options?.sanitizeToolCallIds' "$file"; then
            sed -i 's/allowNonImageSanitization && options?.sanitizeToolCallIds/options?.sanitizeToolCallIds/g' "$file"
            echo "  Applied fix B: Decoupled ID sanitization from sanitizeMode"
            echo "1" > /tmp/patch_applied
        fi
    fi
done

# Check if any patches were applied (using temp file due to subshell)
if [ -f /tmp/patch_applied ]; then
    PATCH_APPLIED=1
    rm -f /tmp/patch_applied
fi

# Verification
echo ""
echo "Verifying patches..."

VERIFY_FAILED=0

# Verify fix A was applied (the old pattern should not exist)
if grep -r '!isOpenAi && sanitizeToolCallIds' "$DIST_DIR" --include="*.js" 2>/dev/null; then
    echo "ERROR: Fix A verification failed - old pattern still exists"
    VERIFY_FAILED=1
fi

# Verify fix B was applied
if grep -r 'allowNonImageSanitization && options?.sanitizeToolCallIds' "$DIST_DIR" --include="*.js" 2>/dev/null; then
    echo "ERROR: Fix B verification failed - old pattern still exists"
    VERIFY_FAILED=1
fi

if [ $VERIFY_FAILED -eq 1 ]; then
    echo ""
    echo "PATCH VERIFICATION FAILED!"
    echo "The OpenClaw version may have changed. Please review and update the patch."
    exit 1
fi

if [ $PATCH_APPLIED -eq 0 ]; then
    echo ""
    echo "ERROR: No patches were applied!"
    echo "The OpenClaw version may have changed its minified code structure."
    echo ""
    echo "Actions required:"
    echo "  1. Check if upstream issue #10640 has been fixed"
    echo "  2. If fixed upstream, remove this patch script and Dockerfile reference"
    echo "  3. If not fixed, update the patch patterns to match the new code structure"
    echo ""
    echo "See: https://github.com/openclaw/openclaw/issues/10640"
    exit 1
fi

echo ""
echo "Tool call ID sanitization fix applied successfully."
