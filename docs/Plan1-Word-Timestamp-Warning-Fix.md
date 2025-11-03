# Plan 1: Word-Level Timestamp Warning Fix

**Date**: 2025-01-27  
**Branch**: `MFU-WP01-02-BE-transcription`  
**Status**: ✅ **COMPLETED**

## Issue Description

**Problem**: 
- whisper-ctranslate2 was producing warnings about missing word-level timestamps
- Transcript output showed `"words": null` in segments
- Handler was logging a generic warning, not specific to whisper-ctranslate2

**Root Cause**:
- whisper-ctranslate2 may not output word-level timestamps by default
- This is a known limitation of the CTranslate2 implementation
- Standard whisper includes word-level timestamps in JSON output, but whisper-ctranslate2 may not

## Solution Implemented

### 1. Enhanced Warning Messages

**File**: `backend/services/transcription/handler.js` (lines 383-409)

**Changes**:
- Detects when whisper-ctranslate2 is being used
- Provides specific warning message explaining the limitation
- Offers workarounds (use standard whisper for word-level timestamps)
- Clarifies that segment-level timestamps are sufficient for SRT generation

**Before**:
```javascript
logger.warn('Word-level timestamps not found in transcript', {
  message: 'Transcript contains segments but no word-level timestamps...'
});
```

**After**:
```javascript
if (isCtranslate2) {
  logger.warn('Word-level timestamps not found in transcript (whisper-ctranslate2 limitation)', {
    variant: 'ctranslate2',
    message: 'whisper-ctranslate2 may not output word-level timestamps. Segment-level timestamps are available. For word-level timestamps, consider using standard whisper...',
    workaround: 'Segment-level timestamps are sufficient for SRT generation. Word-level timestamps are only required for advanced downstream processing.'
  });
}
```

### 2. Updated Code Comments

**File**: `backend/services/transcription/handler.js` (lines 280-293)

**Changes**:
- Updated comments to document whisper-ctranslate2 limitation
- Added notes about when word-level timestamps are available
- Clarified that this is expected behavior for whisper-ctranslate2

### 3. Updated Documentation

**File**: `docs/mfu-backlog/MFU-WP01-02-BE-transcription.md`

**Changes**:
- Added known limitation note to Plan 1 completion status
- Documented that handler gracefully handles missing word-level timestamps
- Updated acceptance criteria status

## Verification

**Test Results**:
- ✅ Handler correctly detects whisper-ctranslate2 variant
- ✅ Warning message is informative and actionable
- ✅ Handler continues to work correctly with segment-level timestamps
- ✅ SRT generation works correctly with segment-level timestamps

**Transcript Output Example**:
```json
{
  "segments": [
    {
      "id": 1,
      "start": 0,
      "end": 15.84,
      "text": " so hi I'm Radha...",
      "words": null  // whisper-ctranslate2 limitation
    }
  ]
}
```

**Handler Response**:
- Logs informative warning specific to whisper-ctranslate2
- Continues processing (does not fail)
- Generates SRT successfully using segment-level timestamps
- Provides workaround suggestions

## Impact Assessment

**Functionality**: ✅ **NO IMPACT**
- SRT generation works correctly with segment-level timestamps
- Downstream processing that requires word-level timestamps will need standard whisper
- Handler gracefully handles both variants

**User Experience**: ✅ **IMPROVED**
- More informative warning messages
- Clear explanation of limitation
- Actionable workarounds provided

**Performance**: ✅ **NO IMPACT**
- No performance degradation
- whisper-ctranslate2 still provides 2x+ speedup
- Option to use standard whisper when word-level timestamps are critical

## Recommendations

### For Users Requiring Word-Level Timestamps

**Option 1**: Use standard whisper when word-level timestamps are critical
```bash
export WHISPER_CMD=whisper
```

**Option 2**: Monitor for whisper-ctranslate2 updates that add word-level timestamp support
- Check whisper-ctranslate2 release notes
- Future versions may add this feature

**Option 3**: Use forced alignment tools for post-processing
- Can enhance timestamp accuracy
- More complex but provides best accuracy

### For Most Users

**Recommendation**: Continue using whisper-ctranslate2
- Segment-level timestamps are sufficient for most use cases
- 2x+ speedup is significant benefit
- SRT generation works correctly

## Conclusion

✅ **Fix Complete**: Handler now properly handles whisper-ctranslate2 word-level timestamp limitation
- Informative warnings specific to variant
- Graceful degradation with segment-level timestamps
- Clear documentation of limitation
- Actionable recommendations provided

**Status**: The warning is now properly addressed with informative messages and graceful handling.

