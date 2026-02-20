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

for file in "$DIST_DIR"/*.js; do
    [ -f "$file" ] || continue

    if grep -q 'sanitizeToolCallIds' "$file"; then
        echo "Processing: $file"

        # Fix A: !isOpenAi&&sanitizeToolCallIds -> sanitizeToolCallIds
        # (removes the OpenAI exclusion from sanitization)
        if grep -q '!isOpenAi&&sanitizeToolCallIds' "$file"; then
            sed -i 's/!isOpenAi&&sanitizeToolCallIds/sanitizeToolCallIds/g' "$file"
            echo "  Applied fix A: Removed OpenAI exclusion from sanitizeToolCallIds"
            PATCH_APPLIED=1
        fi

        # Fix B: allowNonImageSanitization&&options?.sanitizeToolCallIds -> options?.sanitizeToolCallIds
        # (decouples ID sanitization from sanitizeMode)
        if grep -q 'allowNonImageSanitization&&options?.sanitizeToolCallIds' "$file"; then
            sed -i 's/allowNonImageSanitization&&options?.sanitizeToolCallIds/options?.sanitizeToolCallIds/g' "$file"
            echo "  Applied fix B: Decoupled ID sanitization from sanitizeMode"
            PATCH_APPLIED=1
        fi
    fi
done

# Verification
echo ""
echo "Verifying patches..."

VERIFY_FAILED=0

# Verify fix A was applied (the old pattern should not exist)
if grep -r '!isOpenAi&&sanitizeToolCallIds' "$DIST_DIR"/*.js 2>/dev/null; then
    echo "ERROR: Fix A verification failed - old pattern still exists"
    VERIFY_FAILED=1
fi

# Verify fix B was applied
if grep -r 'allowNonImageSanitization&&options?.sanitizeToolCallIds' "$DIST_DIR"/*.js 2>/dev/null; then
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
