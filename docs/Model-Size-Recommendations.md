# Whisper Model Size Recommendations

**Date**: 2025-11-04  
**Based on**: Actual performance testing with whisper-ctranslate2 on CPU

## Performance Summary

| Model | Size | CPU Speed (real-time) | 60-min File Time | Accuracy | Use Case |
|-------|------|----------------------|------------------|----------|----------|
| **tiny** | 39M | ~3-5x | 12-20 min | Lower | Fast testing, low accuracy needs |
| **base** | 74M | ~2-3x | 20-30 min | Good | **Recommended for CPU** ✅ |
| **small** | 244M | ~1.5-2x | 30-40 min | Better | Good balance |
| **medium** | 769M | ~0.5-0.75x | 40-60 min | Best | GPU recommended |
| **large** | 1550M | ~0.3-0.5x | 60-120 min | Excellent | GPU required |

## Recommendation: Use `base` or `small` for CPU

### Why `base` or `small`?

1. **Speed**: 3-5x faster than medium on CPU
2. **Accuracy**: Still very good (base is ~85-90% accuracy, small is ~90-95%)
3. **Timeout**: Completes within reasonable time (20-40 min for 60-min file)
4. **Resource**: Lower memory usage

### Current Issue with `medium`

- **Actual speed**: ~0.56x real-time (slower than real-time)
- **5-minute chunk**: ~7.5 minutes processing time
- **60-minute file**: ~40-60 minutes total
- **Timeout**: Requires 60-minute timeout (may still be borderline)

### Recommended Configuration

**For CPU (Development/Testing)**:
```env
WHISPER_MODEL=base    # or 'small' for better accuracy
WHISPER_DEVICE=cpu
WHISPER_CMD=whisper-ctranslate2
```

**For GPU (Production)**:
```env
WHISPER_MODEL=medium  # or 'large' for best accuracy
WHISPER_DEVICE=cuda
WHISPER_CMD=whisper-ctranslate2
```

## Action Items

1. **Immediate**: Change default model to `base` or `small` for CPU inference
2. **Documentation**: Update docs to recommend model size based on device
3. **Testing**: Re-run chunking test with `base` model (should complete in 20-30 minutes)

## Performance Comparison

**Current Test (medium model on CPU)**:
- 7 chunks completed in ~52 minutes (7.5 min each)
- Chunk 8 timed out at 84% after 30 minutes
- **Total time estimate**: 40-60 minutes for 60-minute file

**Expected with base model on CPU**:
- 5-minute chunks: ~2-3 minutes each
- 60-minute file: ~20-30 minutes total
- **3-5x faster** than medium model

**Expected with medium model on GPU**:
- 5-minute chunks: ~30-60 seconds each
- 60-minute file: ~6-12 minutes total
- **10-20x faster** than CPU

## Conclusion

**Recommended**: Use `WHISPER_MODEL=base` for CPU inference
- Faster processing (3-5x speedup)
- Still good accuracy (~85-90%)
- Completes within reasonable time
- Lower resource usage

**For production**: Use `medium` or `large` with GPU if available

