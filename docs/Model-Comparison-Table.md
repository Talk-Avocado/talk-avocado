# Whisper Model Size Comparison

**Date**: 2025-11-04  
**Device**: CPU (no GPU available)

## Model Comparison Table

| Model | Size | CPU Speed | 60-min File | Accuracy | Best For |
|-------|------|-----------|-------------|----------|----------|
| **base** | 74M | 3-5x faster than medium | ~20-30 min | ~85-90% | ⭐ Speed priority |
| **small** | 244M | 2-3x faster than medium | ~30-40 min | ~90-95% | ⭐ Balance |
| **medium** | 769M | ~0.56x real-time | ~40-60 min | ~90-95% | GPU only |
| **large** | 1550M | ~0.3-0.5x real-time | ~60-120 min | ~95-98% | GPU required |

## Detailed Comparison

### 1. BASE Model (Current Default)

**Pros:**
- ✅ **Fastest on CPU**: 3-5x faster than medium
- ✅ **Good accuracy**: ~85-90% (sufficient for most use cases)
- ✅ **Low resource usage**: Smallest model (74M parameters)
- ✅ **Quick processing**: 60-minute file in 20-30 minutes

**Cons:**
- ⚠️ Lower accuracy than small/medium (~5-10% less)
- ⚠️ May miss some words in complex audio

**Best For:**
- Speed is critical
- Good accuracy is sufficient
- Large volume of files to process
- CPU-only environments

---

### 2. SMALL Model (Recommended Alternative)

**Pros:**
- ✅ **Faster than medium**: 2-3x faster than medium
- ✅ **Better accuracy**: ~90-95% (better than base)
- ✅ **Good balance**: Good speed + better accuracy
- ✅ **Reasonable time**: 60-minute file in 30-40 minutes

**Cons:**
- ⚠️ Slower than base (~1.5-2x real-time vs 2-3x)
- ⚠️ Takes longer: 30-40 min vs 20-30 min for 60-min file

**Best For:**
- Balance of speed and accuracy
- Better accuracy needed but can't use medium
- When accuracy is more important than speed

---

### 3. MEDIUM Model (Not Recommended for CPU)

**Pros:**
- ✅ **Best accuracy**: ~90-95% (same as small)
- ✅ **Well-tested**: Most common model size

**Cons:**
- ❌ **Very slow on CPU**: ~0.56x real-time (slower than real-time)
- ❌ **Long processing**: 60-minute file takes 40-60 minutes
- ❌ **Timeouts**: 5-minute chunks take 7.5 minutes each
- ❌ **Not practical**: Requires 60-minute timeout

**Best For:**
- GPU environments only (10-20x faster on GPU)
- When accuracy is critical and GPU available

---

## Recommendation

### For CPU (Current Setup)

**Option 1: BASE Model (Current Default)** ⭐
- **Why**: Fastest on CPU, good accuracy
- **When**: Speed is priority, good accuracy sufficient
- **Time**: 20-30 minutes for 60-minute file

**Option 2: SMALL Model (Your Suggestion)** ⭐
- **Why**: Better accuracy than base, still fast
- **When**: Balance of speed and accuracy needed
- **Time**: 30-40 minutes for 60-minute file

**Option 3: MEDIUM Model (Not Recommended)**
- **Why**: Too slow on CPU, frequent timeouts
- **When**: Only if GPU available
- **Time**: 40-60 minutes for 60-minute file (with timeouts)

### My Recommendation

**Use `base` model if:**
- ✅ Speed is critical
- ✅ Processing many files
- ✅ 85-90% accuracy is sufficient
- ✅ Need fastest possible processing

**Use `small` model if:**
- ✅ Want better accuracy than base
- ✅ Can accept slightly longer processing time
- ✅ Need 90-95% accuracy
- ✅ Balance of speed and accuracy is important

**Use `medium` model if:**
- ✅ GPU is available (10-20x faster)
- ✅ Need best accuracy possible
- ❌ NOT recommended for CPU-only

---

## Performance Comparison

### Speed Comparison (relative to medium on CPU)

| Model | Speed Factor | Real-time Factor | 5-min Chunk Time |
|-------|--------------|------------------|------------------|
| base | 3-5x faster | ~2-3x | ~2-3 minutes |
| small | 2-3x faster | ~1.5-2x | ~2.5-3.5 minutes |
| medium | 1x (baseline) | ~0.56x | ~7.5 minutes |

### Accuracy Comparison

| Model | Accuracy | Use Cases |
|-------|----------|-----------|
| base | ~85-90% | General transcription, clear audio |
| small | ~90-95% | Professional audio, better accuracy needed |
| medium | ~90-95% | Best accuracy, GPU recommended |

---

## Decision Matrix

**Choose BASE if:**
- Speed > Accuracy
- Processing time is critical
- Good accuracy is sufficient

**Choose SMALL if:**
- Speed ≈ Accuracy (balance)
- Want better accuracy than base
- Can accept longer processing time

**Choose MEDIUM if:**
- Accuracy > Speed
- GPU available
- Best accuracy needed

---

## Action Items

1. **Try `base` model** (current default) - fastest
2. **Try `small` model** if you need better accuracy
3. **Compare results** - test both and see which meets your needs
4. **Use `medium`** only if GPU becomes available

---

## Conclusion

**For CPU-only environments:**
- ✅ **BASE**: Fastest, good accuracy (recommended for speed)
- ✅ **SMALL**: Better accuracy, still fast (recommended for balance)
- ❌ **MEDIUM**: Too slow, not practical (GPU only)

**Your suggestion to use `small` is valid** - it's a good middle ground with better accuracy than `base` while still being faster than `medium`.

