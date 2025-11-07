# Smart Cut Planner - Improvements for "Um" and "Uh" Detection

## Current Methods

1. **Word-level timestamps from Whisper** - Detects transcribed filler words
2. **Audio-based silence detection** - Uses FFmpeg's `silencedetect` to find gaps
3. **Transcript-based silence detection** - Finds gaps between segments

## Limitations

- "Um" and "uh" sounds are often **not transcribed** by Whisper (filtered out as non-speech)
- Very short filler sounds (< 200ms) may not be detected as silence
- Low-volume "ums" might not trigger silence detection but are still audible
- Current silence detection threshold (300ms) might miss very brief filler sounds

## Proposed Improvements

### 1. **More Aggressive Silence Detection** (Quick Win)
- Lower silence threshold from 300ms to **150-200ms**
- Lower noise threshold from -35dB to **-40dB** (more sensitive)
- Expand cut regions around detected silences more aggressively

### 2. **Voice Activity Detection (VAD)** (Medium Effort)
- Use FFmpeg's `silencedetect` with VAD to detect actual speech boundaries
- Detect low-energy segments that might contain filler sounds
- Identify segments where speech energy drops significantly (indicating hesitation)

### 3. **Audio Energy Analysis** (Medium Effort)
- Analyze audio energy levels to find low-energy segments
- "Um" and "uh" often have lower energy than normal speech
- Use FFmpeg's `astats` filter to detect energy drops

### 4. **Phoneme-Level Detection** (High Effort)
- Use forced alignment tools (e.g., `whisper-timestamped`, `aeneas`) for precise phoneme timing
- Detect common filler phonemes: /ʌm/, /ʌ/, /ə/, /ɜː/
- More accurate than word-level detection

### 5. **Machine Learning Approach** (High Effort)
- Train a model to detect filler sounds directly from audio
- Use pre-trained models for speech disfluency detection
- More accurate but requires training data and model integration

### 6. **Hybrid Approach** (Recommended)
Combine multiple methods:
- **Audio-based**: Silence detection + energy analysis
- **Transcript-based**: Word-level timestamps + forced alignment
- **Pattern matching**: Detect common filler patterns in audio

## Implementation Priority

### Phase 1: Quick Wins (Immediate)
1. Lower silence detection threshold to 150-200ms
2. Lower noise threshold to -40dB
3. Expand cut regions more aggressively (0.5s before/after)
4. Add audio energy analysis for low-energy segments

### Phase 2: Enhanced Detection (Short-term)
1. Implement VAD for better speech boundary detection
2. Add forced alignment for more precise word timestamps
3. Combine multiple detection methods with confidence scoring

### Phase 3: Advanced Features (Long-term)
1. Machine learning-based filler sound detection
2. Custom phoneme-level detection
3. Adaptive thresholds based on speaker characteristics

## Recommended Next Steps

1. **Start with Phase 1 improvements** - Easy to implement, immediate impact
2. **Test with sample videos** - Measure improvement in detection accuracy
3. **Iterate based on results** - Adjust thresholds and methods based on real-world performance


