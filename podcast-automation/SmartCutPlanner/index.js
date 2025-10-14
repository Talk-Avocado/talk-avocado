// SmartCutPlanner.js (Debug Mode — Recovery + Raw API logging + no fail-stop on empty)
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import https from "https";
import { execSync } from "child_process";
import path from "path";
import dotenv from "dotenv";
import { logger } from "scripts/logger.js";

// Load .env for local mode from project root
if (process.env.LOCAL_MODE === "true") {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}


const s3 = new S3Client({
  region: "eu-west-2",
  forcePathStyle: true,
  endpoint: "https://s3.eu-west-2.amazonaws.com"
});

const secrets = new SecretsManagerClient({ region: "eu-west-2" });

// Timestamp formatting helper — must be defined before mergeCutsWithSnapping()
function secondsToTimestamp(sec) {
  const minutes = Math.floor(sec / 60);
  const seconds = (sec % 60).toFixed(2).padStart(5, "0");
  return `${minutes.toString().padStart(2, "0")}:${seconds}`;
}

// Snap cut points to nearest transcript word boundaries safely
function snapToWordBoundary(sec, transcriptWords, toEnd = false) {
  if (!Array.isArray(transcriptWords) || transcriptWords.length === 0) {
    return parseFloat(sec) || 0; // fallback to given sec
  }

  let closest = sec;
  let minDiff = Infinity;

  for (const w of transcriptWords) {
    if (typeof w.start !== "number" || typeof w.end !== "number") continue;
    const candidate = toEnd ? w.end : w.start;
    const diff = Math.abs(candidate - sec);
    if (diff < minDiff) {
      minDiff = diff;
      closest = candidate;
    }
  }

  // Ensure it's a number and round to 2 decimal places
  return parseFloat(Number(closest).toFixed(2)) || 0;
}

// Validate cut schema
function isValidCutSchema(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.cuts)) return false;
  return json.cuts.every(cut =>
    typeof cut.start === "string" &&
    typeof cut.end === "string" &&
    typeof cut.reason === "string" &&
    typeof cut.confidence === "number"
  );
}

// Layer 3 JSON translator
async function layer3TranslateToValidJSON(rawOutput, fallbackCuts) {
  // Attempt strict parse & schema validation first
  const parsed = safeParseJSON(rawOutput, null);
  if (isValidCutSchema(parsed)) {
    logger.info(`✅ Layer 2 output passed strict JSON/schema validation — skipping Layer 3`);
    return parsed.cuts;
  }
  
  // Fallback to provided cuts if parsing fails
  logger.warn(`⚠️ Layer 2 output failed validation — using fallback cuts`);
  return fallbackCuts || [];
}

// Score cut function
function scoreCut(cut, transcriptWords) {
  const segWords = transcriptWords.filter(w => w.start >= cut.startSec && w.end <= cut.endSec);
  const wordCount = segWords.length;
  const uniqueCount = new Set(segWords.map(w => w.word.toLowerCase())).size;
  const duration = cut.endSec - cut.startSec;
  const density = wordCount / (duration || 1);
  
  // Simple scoring: prefer cuts with fewer words and lower density
  return {
    wordCount,
    uniqueCount,
    density,
    score: wordCount * 0.5 + density * 0.3 + (uniqueCount / wordCount) * 0.2
  };
}

// Get cut context for safety validation
function getCutContextForSafety(cut, structuredWords) {
  const startCtx = Math.max(0, toSeconds(cut.start) - 1.5);
  const endCtx = toSeconds(cut.end) + 1.5;
  return structuredWords.filter(w => w.start >= startCtx && w.end <= endCtx);
}

// Final fail-safe validation
function finalFailSafe(cuts, videoDuration) {
  const MIN_GAP = 0.5;
  const MAX_DENSITY = 10; // max 1 cut every 10s unless silence
  let lastTime = -Infinity;
  const safeCuts = cuts.filter(cut => {
    const dur = toSeconds(cut.end) - toSeconds(cut.start);
    if (dur <= 0 || dur > videoDuration) return false;
    if ((toSeconds(cut.start) - lastTime) < MIN_GAP && !/(silence|pause)/i.test(cut.reason)) return false;
    lastTime = toSeconds(cut.end);
    return true;
  });
  return safeCuts;
}

/**
 * Merges close and short cuts with optional snapping to nearest transcript word boundaries.
 * Used in both strict and non-strict modes to keep behavior identical.
 */
function mergeCutsWithSnapping(cutRanges, structuredWords) {

  const snapStart = sec => snapToWordBoundary(sec, structuredWords, false);
  const snapEnd = sec => snapToWordBoundary(sec, structuredWords, true);

  return cutRanges.reduce((merged, cut, idx, arr) => {
    const dur = toSeconds(cut.end) - toSeconds(cut.start);

    // === Rule 1: Merge if <0.5s gap and gap contains only filler words
    if (
      merged.length &&
      (toSeconds(cut.start) - toSeconds(merged[merged.length - 1].end)) < 0.5
    ) {
      const gapStart = toSeconds(merged[merged.length - 1].end);
      const gapEnd = toSeconds(cut.start);
      const gapWords = structuredWords.filter(w => w.start >= gapStart && w.end <= gapEnd);
      const fillerSet = new Set(["uh","um","ah","er","mm","you know","like","sort of","kind of","okay so","right?","i mean","well","actually","basically","literally","honestly","essentially","anyway","so"]);

      if (gapWords.every(w => fillerSet.has(w.word.toLowerCase().trim()))) {
        merged[merged.length - 1].end = cut.end;
        merged[merged.length - 1].reason += " + " + cut.reason;
        merged[merged.length - 1].confidence = Math.max(
          merged[merged.length - 1].confidence || 0,
          cut.confidence || 0
        );
        return merged;
      }
    }

    // === Rule 2: Merge any short cut (<0.25s) into nearest neighbor, snapping to word boundaries
    if (dur < 0.25) {
      logger.warn(`↔️ Merging short cut ${cut.start}–${cut.end} (${dur.toFixed(2)}s) into neighbor`);

      // Try previous matching reason
      if (merged.length > 0) {
        let prev = merged[merged.length - 1];
        if (prev.reason.split(" + ")[0] === cut.reason.split(" + ")[0]) {
          prev.end = secondsToTimestamp(snapEnd(toSeconds(cut.end)));
          prev.reason += " + " + cut.reason;
          prev.confidence = Math.max(prev.confidence || 0, cut.confidence || 0);
          return merged;
        }
      }

      // Try next matching reason (only possible if we look ahead in `arr`)
      if (idx < arr.length - 1) {
        let next = arr[idx + 1];
        if (next.reason.split(" + ")[0] === cut.reason.split(" + ")[0]) {
          next.start = secondsToTimestamp(snapStart(toSeconds(cut.start)));
          next.reason = cut.reason + " + " + next.reason;
          next.confidence = Math.max(cut.confidence || 0, next.confidence || 0);
          return merged;
        }
      }

      // Fallback: merge into previous neighbor regardless of reason
      if (merged.length > 0) {
        let prev = merged[merged.length - 1];
        prev.end = secondsToTimestamp(snapEnd(toSeconds(cut.end)));
        prev.reason += " + " + cut.reason;
        prev.confidence = Math.max(prev.confidence || 0, cut.confidence || 0);
      } else if (idx < arr.length - 1) {
        let next = arr[idx + 1];
        next.start = secondsToTimestamp(snapStart(toSeconds(cut.start)));
        next.reason = cut.reason + " + " + next.reason;
        next.confidence = Math.max(cut.confidence || 0, next.confidence || 0);
        merged.push(next);
      }
      return merged;
    }

    // Keep normal cut
    merged.push(cut);
    return merged;
  }, []);
}

export const handler = async (event) => {
  const record = event.Records?.[0];
  const bucket = record?.s3?.bucket?.name;
  const key = decodeURIComponent(record?.s3?.object?.key.replace(/\+/g, " "));

  if (!key.endsWith(".json")) {
    logger.info("⏭ Skipped non-json file:", key);
    return;
  }

  try {
    let apiKey;
    if (process.env.LOCAL_MODE === "true") {
      apiKey = process.env.OPENAI_API_KEY;
    } else {
      const secret = await secrets.send(new GetSecretValueCommand({ SecretId: "OpenAIWhisperAPIKey" }));
      apiKey = JSON.parse(secret.SecretString).OPENAI_API_KEY;
    }


    let whisperJsonRaw;
    if (process.env.LOCAL_MODE === "true") {
      const { readFileSync } = await import("fs");
      const { resolve } = await import("path");
      const localPath = resolve(__dirname, "..", "test-assets", key);
      whisperJsonRaw = readFileSync(localPath, "utf8");
    } else {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      whisperJsonRaw = await response.Body.transformToString();
    }

    const whisperJson = JSON.parse(whisperJsonRaw);

    const base = key.replace(/^transcripts\//, "").replace(/\.json$/, "");
    const polishedKey = `polished/${base}.polished.md`;
    const cutplanKey = `plans/${base}.cutplan.json`;

    let structuredWords = extractWordData(whisperJson);

    if (!Array.isArray(structuredWords) || structuredWords.length === 0) {
      if (Array.isArray(whisperJson.segments)) {
        const recovered = whisperJson.segments.flatMap(s => s.words || []);
        if (recovered.length) {
          logger.warn(`⚠️ Recovered ${recovered.length} words from segments[].words`);
          structuredWords = recovered.map(w => ({
            start: parseFloat(Number(w.start).toFixed(2)),
            end: parseFloat(Number(w.end).toFixed(2)),
            word: String(w.word)
          }));
        }
      }
    }

    if (!Array.isArray(structuredWords) || structuredWords.length === 0) {
      logger.error(`❌ No usable word-level data found in transcript for ${base}`);
      logger.error("📄 Raw Whisper JSON dump (truncated to 5000 chars):\n", whisperJsonRaw.slice(0, 5000));
      // Instead of throwing, still proceed with dummy cut for debug continuity
      structuredWords = [{ start: 0.0, end: 0.2, word: "[NO_WORDS_FOUND]" }];
    }

    let prevChunkSummary = "";

    let strictMode = false; // switches on if cut density is high


    // === Detect wordless time ranges ===
    // Reduced to catch shorter natural pauses
    const WORDLESS_THRESHOLD = 0.5; // seconds with no transcript words

    let wordlessRanges = [];

    for (let i = 1; i < structuredWords.length; i++) {
      const prevEnd = structuredWords[i - 1].end;
      const nextStart = structuredWords[i].start;
      const gap = nextStart - prevEnd;

      if (gap >= WORDLESS_THRESHOLD) {
        wordlessRanges.push({
          start: parseFloat(prevEnd.toFixed(2)),
          end: parseFloat(nextStart.toFixed(2)),
          duration: parseFloat(gap.toFixed(2))
        });
      }
    }

    logger.info(`🕳 Detected ${wordlessRanges.length} wordless ranges >= ${WORDLESS_THRESHOLD}s`);

    // --- Chunked processing to avoid token limit ---
    const maxWordsPerChunk = 1200; // safe size for GPT-4o TPM limits
    let allCutRanges = [];
    let fullPolishedTranscript = "";

    let parsedJson = null; // Holds parsed JSON results for later fallback check

    for (let i = 0; i < structuredWords.length; i += maxWordsPerChunk) {
  const contextWindowStart = Math.max(0, i - 200); // ~15s worth of words for context
  const chunkWords = structuredWords.slice(contextWindowStart, i + maxWordsPerChunk);

  // ===== LAYER 1: Aggressive Detection =====
  const detectionPrompt = `
You are a professional video/podcast editor.
Identify ALL timestamps of filler words or dead-air ≥0.5s in the transcript, even if mid-sentence.
Be generous in detection, even if unsure — Layer 2 will decide.
Do not decide if they should be cut — just detect every possible candidate.
Filler words: uh, um, ah, er, mm, you know, like, sort of, kind of, okay so, right?, i mean, well, actually, basically, literally, honestly, essentially, anyway, so.
Also detect any pauses/silence ≥ 0.5s with no words.
Confidence rules:
- Clear filler/silence: confidence 1.0
- Possible filler/silence but less certain: confidence 0.9

Return ONLY valid JSON:
{
  "cuts": [
    { "start": "SS.SS", "end": "SS.SS", "reason": "string", "confidence": 0.xx }
  ]
}

Transcript Words JSON:
${JSON.stringify(chunkWords, null, 2)}

Known wordless-time ranges:
${JSON.stringify(wordlessRanges, null, 2)}
`;


  logger.info(`📤 [Layer 1] Sending detection request for chunk ${Math.floor(i / maxWordsPerChunk) + 1}`);
  let { output: layer1Raw } = await callOpenAI(apiKey, detectionPrompt);
  let layer1Cuts = [];
  layer1Cuts = safeParseJSON(layer1Raw, { cuts: [] }).cuts || [];

// Pre-drop cuts shorter than 0.15s or containing non-filler words
const fillerSet = new Set(["uh","um","ah","er","mm","you know","like","sort of","kind of","okay so","right?","i mean","well","actually","basically","literally","honestly","essentially","anyway","so"]);
layer1Cuts = layer1Cuts.filter(cut => {
  const dur = toSeconds(cut.end) - toSeconds(cut.start);
  if (dur < 0.15) return false;
  const segWords = structuredWords.filter(w => w.start >= toSeconds(cut.start) && w.end <= toSeconds(cut.end));
  return segWords.every(w => fillerSet.has(w.word.toLowerCase().trim()));
});


  // ===== LAYER 2: Flow & Meaning Refinement =====

// Build contextual view for GPT (±1.5s before/after)
function getCutContext(cut, structuredWords) {
  const startCtx = Math.max(0, toSeconds(cut.start) - 1.5);
  const endCtx = toSeconds(cut.end) + 1.5;
  return structuredWords.filter(w => w.start >= startCtx && w.end <= endCtx);
}

// Attach context to each proposed cut from Layer 1
const cutsWithContext = layer1Cuts.map(cut => ({
  ...cut,
  context: getCutContext(cut, structuredWords)
}));

// === LAYER 2 HYBRID PROMPT — combines strict editing rules + conversational context awareness ===
const refinementRules = `
You are a senior podcast/video editor with deep understanding of pacing, comedic timing, and conversational nuance.

TASK: You will receive proposed cut segments, surrounding context, the full transcript for this chunk, and known wordless-time ranges.
You must decide which cuts to keep or drop, applying BOTH technical rules AND human editing judgment.

OUTPUT: Only valid JSON in this exact schema, no commentary, no markdown, no extra keys:
{
  "cuts": [
    { "start": "SS.SS", "end": "SS.SS", "reason": "string", "confidence": 0.xx }
  ]
}

RULES:
1. Keep only pure filler or dead-air cuts with no risk to pacing, humor, emotion, or meaning.
2. Remove fillers if mid-sentence AND there is <0.10s gap before and after.
3. Drop any cut containing at least one non-filler word.
4. Drop any silence cut with <80% overlap with known wordless-time ranges.
5. Keep pauses that add personality, emphasis, or comedic effect.
6. Err on the side of KEEPING speech if uncertain — avoid over-cutting.
7. Preserve long silences only if they mark clear topic/scene transitions.
8. Output must always be a JSON object with a "cuts" array — no other format.

MARKERS:
- Wrap your JSON output between ###JSON_START and ###JSON_END with no other text outside.
`;

const refinementPrompt = `
Proposed cuts (with ±1.5s transcript context for each):
${JSON.stringify(cutsWithContext, null, 2)}

Full transcript words for this chunk:
${JSON.stringify(chunkWords, null, 2)}

Known wordless-time ranges:
${JSON.stringify(wordlessRanges, null, 2)}
`;



  logger.info(`📤 [Layer 2] Sending refinement request for chunk ${Math.floor(i / maxWordsPerChunk) + 1}`);
  let { output: layer2Raw } = await callOpenAI(apiKey, {
    system: refinementRules,
    user: refinementPrompt
  });
  
      
 // ===== LAYER 3: JSON Translator & Finalizer (Conditional Execution) =====
  // Attempt strict parse & schema validation first
  const parsed = safeParseJSON(rawOutput, null);
  if (isValidCutSchema(parsed)) {
    logger.info(`✅ Layer 2 output passed strict JSON/schema validation — skipping Layer 3`);
    return parsed.cuts;
  }

  // If invalid, run GPT repair
  logger.warn("⚠️ Layer 2 output invalid — running Layer 3 JSON translation.");
  const { output: fixedRaw } = await callOpenAI(apiKey, {
    system: `
      You are a JSON repair engine.
      Your job is to take possibly broken JSON describing video cuts and return valid JSON in this exact schema:
      {
        "cuts": [
          { "start": "SS.SS", "end": "SS.SS", "reason": "string", "confidence": 0.xx }
        ]
      }
      Do not add, remove, or change the cut meanings.
      If any required field is missing, fill it from provided context.
      Output ONLY valid JSON. No commentary, no markdown fences.
    `,
    user: JSON.stringify({ broken_output: rawOutput, context_cuts: fallbackCuts })
  });

  const fixedParsed = safeParseJSON(fixedRaw, null);
  if (isValidCutSchema(fixedParsed)) {
    logger.info(`✅ Layer 3 fixed JSON — ${fixedParsed.cuts.length} cuts.`);
    return fixedParsed.cuts;
  } else {
    logger.warn("⚠️ Layer 3 failed — falling back to Layer 1 cuts WITH context.");
    return fallbackCuts;
  }
}


// Apply Layer 3 translation immediately after Layer 2
let chunkCutRanges = await layer3TranslateToValidJSON(layer2Raw, cutsWithContext);

// Merge into global cut list
allCutRanges.push(...chunkCutRanges);

    
        // Merge into global cut list — old downstream filters will handle the rest
        allCutRanges.push(...chunkCutRanges);
      } // end for-loop

      // Continue outer try — do NOT close it here
      
      
      // Remove duplicates + clean and sort cuts
      
let cutRanges = [];
const seen = new Set();
for (const cut of allCutRanges) {
  const id = `${cut.start}-${cut.end}-${cut.reason}`;
  if (!seen.has(id)) {
    seen.add(id);
    cutRanges.push(cut);
  }
}

// ---- VALUE SCORING FILTER ----
// ✅ Normalize startSec/endSec before scoring
cutRanges = cutRanges.map(cut => ({
  ...cut,
  startSec: toSeconds(cut.start),
  endSec: toSeconds(cut.end)
}));

// scoreCut function moved to top level

logger.info("📉 Before scoring filter:", JSON.stringify(cutRanges, null, 2));
cutRanges = cutRanges.filter(cut => {
  const score = scoreCut(cut, structuredWords);
  logger.info(`   📝 Cut ${cut.start}–${cut.end} [reason: ${cut.reason}] → score=${score.toFixed(2)}`);
  return score >= 0.3;
});
logger.info("✅ After scoring filter:", JSON.stringify(cutRanges, null, 2));



// ---- MAX MERGE LENGTH GUARD ----
// Trim or reject cuts longer than 3.0s
cutRanges = cutRanges.map(cut => {
  const duration = cut.endSec - cut.startSec;
  const isSilence = /(long pause|silence)/i.test(cut.reason);

  if (duration > 3.0) {
    // Allow long silence only if fully inside one known wordless range of same length
    let allowLongSilence = false;
    if (isSilence) {
      allowLongSilence = wordlessRanges.some(wr =>
        wr.start >= cut.startSec &&
        wr.end <= cut.endSec &&
        (wr.end - wr.start) >= duration
      );
    }

    if (!allowLongSilence) {
      logger.warn(`⚠️ Trimming oversized cut (${duration.toFixed(2)}s): ${cut.reason}`);
      cut.endSec = cut.startSec + 3.0;
      cut.end = secondsToTimestamp(cut.endSec);
    }
  }
  return cut;
});



// Convert to seconds, filter zero/negative durations, sort, and remove overlaps
cutRanges = cutRanges
  .map(cut => ({
    ...cut,
    startSec: toSeconds(cut.start),
    endSec: toSeconds(cut.end)
  }))
  .filter(cut => {
    const valid = (
      !isNaN(cut.startSec) &&
      !isNaN(cut.endSec) &&
      cut.endSec > cut.startSec
    );
    if (!valid) logger.warn(`⚠️ Dropping invalid cut: ${cut.start} → ${cut.end} (${cut.reason})`);
    return valid;
  })

  .sort((a, b) => a.startSec - b.startSec);

 

// Step 1: Remove cuts shorter than 0.25s
cutRanges = cutRanges.filter(cut => (cut.endSec - cut.startSec) >= 0.25);

// Step 2: Enforce a minimum gap of 0.5s between cuts
cutRanges = cutRanges.filter((cut, idx, arr) => {
  if (idx === 0) return true;
  return (cut.startSec - arr[idx - 1].endSec) >= 0.5;
});

// Step 3: Enforce max density (no more than 1 cut every 10s unless "long pause" or "silence")
let lastCutTime = -Infinity; // ✅ declare once here
cutRanges = cutRanges.filter(cut => {
  const startSec = toSeconds(cut.start);
  if ((startSec - lastCutTime) >= 10 || /(long pause|silence)/i.test(cut.reason)) {
    lastCutTime = startSec;
    return true;
  }
  return false;
});



// Step 4: Merge again if any cuts still overlap
const finalCuts = [];
for (const cut of cutRanges) {
  if (finalCuts.length > 0 && cut.startSec < finalCuts[finalCuts.length - 1].endSec) {
    // Extend previous cut and merge reasons without duplicates
    finalCuts[finalCuts.length - 1].endSec = Math.max(finalCuts[finalCuts.length - 1].endSec, cut.endSec);
    finalCuts[finalCuts.length - 1].end = secondsToTimestamp(finalCuts[finalCuts.length - 1].endSec);
    const reasons = new Set(finalCuts[finalCuts.length - 1].reason.split(" + ").concat(cut.reason.split(" + ")));
    finalCuts[finalCuts.length - 1].reason = Array.from(reasons).join(" + ");
  } else {
    finalCuts.push({ ...cut });
  }
}


cutRanges = cutRanges.map(cut => {
  const startSec = snapToWordBoundary(toSeconds(cut.start), structuredWords, false);
  const endSec = snapToWordBoundary(toSeconds(cut.end), structuredWords, true);
  return {
    ...cut,
    start: secondsToTimestamp(startSec),
    end: secondsToTimestamp(endSec)
  };
});

// Step 5: Final map to only include start/end timestamps and reason
cutRanges = finalCuts.map(({ startSec, endSec, reason, confidence }) => ({
  start: secondsToTimestamp(startSec),
  end: secondsToTimestamp(endSec),
  reason,
  confidence
}));

// === Merge very close cuts (<0.5s gap) to avoid jumpiness — with word-boundary snapping for short cuts
cutRanges = mergeCutsWithSnapping(cutRanges, structuredWords);


// Re-run min gap & density rules after merge
cutRanges = cutRanges.filter((cut, idx, arr) => {
  if (idx === 0) return true;
  const prevEndSec = toSeconds(arr[idx - 1].end);
  return (toSeconds(cut.start) - prevEndSec) >= 0.5;
});

lastCutTime = -Infinity; // ✅ just reset, no "let"
cutRanges = cutRanges.filter(cut => {
  const startSec = toSeconds(cut.start);
  if ((startSec - lastCutTime) >= 10 || /(long pause|silence)/i.test(cut.reason)) {
    lastCutTime = startSec;
    return true;
  }
  return false;
});


if (cutRanges.length === 0) {
  logger.warn("⚠️ No valid cuts found — skipping cut plan, will copy original video.");
  return; // Let VideoRenderEngine copy original
}


// Hard cap: if more than 30% of chunk duration is being cut, skip refinement and keep Layer 1 output
const totalDuration = structuredWords.length > 0 ? structuredWords[structuredWords.length - 1].end - structuredWords[0].start : 0;
const totalCutDur = cutRanges.reduce((sum, c) => sum + (toSeconds(c.end) - toSeconds(c.start)), 0);
if (totalDuration > 0 && (totalCutDur / totalDuration) > 0.3) {
  logger.warn("⚠️ Cut density > 30% — enabling STRICT refinement mode instead of skipping.");
  strictMode = true;

  const STRICT_MAX_CUT_LENGTH = 5.0; // seconds
  cutRanges = cutRanges.map(cut => {
    const dur = toSeconds(cut.end) - toSeconds(cut.start);
    if (dur > STRICT_MAX_CUT_LENGTH) {
      logger.warn(`   ✂️ Trimming long cut for strict mode: ${cut.start}–${cut.end} (${dur.toFixed(2)}s)`);
      return {
        ...cut,
        end: secondsToTimestamp(toSeconds(cut.start) + STRICT_MAX_CUT_LENGTH),
        confidence: Math.min(cut.confidence ?? 1, 0.95)
      };
    }
    return cut;
  });

  // 🔄 Merge any too-short cuts (<0.25s) into nearest matching-reason neighbor first, else nearest — with word-boundary snapping
  cutRanges = mergeCutsWithSnapping(cutRanges, structuredWords);



  cutRanges = cutRanges.filter((cut, idx, arr) => {
    if (idx === 0) return true;
    const gap = toSeconds(cut.start) - toSeconds(arr[idx - 1].end);
    return gap >= 1.0;
  });
}



// SAFETY: Flag sections with excessive cuts for review
let overcutFlag = false;
let slidingWindow = [];
cutRanges.forEach(cut => {
  slidingWindow.push(cut);
  // remove cuts older than 30s from current cut
  slidingWindow = slidingWindow.filter(c => toSeconds(cut.start) - toSeconds(c.start) <= 30);
  if (slidingWindow.length > 6) overcutFlag = true;
});

if (overcutFlag) {
  logger.warn("⚠️ High cut density detected — marking for manual review");
  cutRanges.push({ start: "00:00.0", end: "00:00.2", reason: "manual-review" });
}

// === SAFETY NET: Second GPT pass to validate filler cuts ===
if (cutRanges.length > 0) {
  // --- SAFETY NET: Second GPT pass to validate filler cuts WITH per-cut context ---
// getCutContextForSafety function moved to top level

const cutsWithSafetyContext = cutRanges.map(cut => ({
  ...cut,
  context: getCutContextForSafety(cut, structuredWords)
}));






  try {
    const validationPrompt = `
You are a senior podcast/video editor verifying a proposed cut list.
Only keep cuts that are true filler or dead-air with no risk to pacing, humor, or meaning.
Remove any cut that contains meaningful words or speech.
Maintain the exact JSON schema:

{
  "cuts": [
    { "start": "SS.SS", "end": "SS.SS", "reason": "string", "confidence": 0.xx }
  ]
}

RULES:
- Do not change start/end values except to ensure valid SS.SS format.
- Only include cuts that are clearly safe to remove.
- Output must be valid JSON only — no commentary, no extra keys.

Proposed cuts:
${JSON.stringify(cutsWithSafetyContext, null, 2)}

Transcript words:
${JSON.stringify(structuredWords, null, 2)}

Known wordless-time ranges:
${JSON.stringify(wordlessRanges, null, 2)}
`;






    let { output: validatedCutsRaw } = await callOpenAI(apiKey, validationPrompt);
    
    // 🚨 Safety Net Output Guard — prevent crash if GPT output is malformed
if (typeof validatedCutsRaw !== "string") {
  logger.warn("⚠️ Safety Net GPT output is not a string — forcing empty JSON object");
  validatedCutsRaw = '{"cuts": []}';
} else {
  // Remove markdown fences and stray text before parse
  validatedCutsRaw = validatedCutsRaw.replace(/```json|```/g, '').trim();
}

// Attempt parse
let parsedSafetyNet = safeParseJSON(validatedCutsRaw, null);
let validatedCuts = (parsedSafetyNet && Array.isArray(parsedSafetyNet.cuts))
  ? parsedSafetyNet.cuts
  : [];

// Validate schema
const schemaValid = Array.isArray(validatedCuts) && validatedCuts.every(cut =>
  typeof cut.start === "string" &&
  typeof cut.end === "string" &&
  typeof cut.reason === "string" &&
  typeof cut.confidence === "number"
);

if (!schemaValid) {
  logger.warn("⚠️ Safety Net output invalid — running Layer 3 repair.");
  validatedCuts = await layer3TranslateToValidJSON(validatedCutsRaw, cutsWithSafetyContext);
}

// Final schema check — if still invalid, force empty array
if (!Array.isArray(validatedCuts) || !validatedCuts.every(cut =>
  typeof cut.start === "string" &&
  typeof cut.end === "string" &&
  typeof cut.reason === "string" &&
  typeof cut.confidence === "number"
)) {
  logger.error("❌ Safety Net still invalid after Layer 3 repair — forcing empty cut list");
  validatedCuts = [];
}


// Auto-run Layer 3 repair if invalid
if (!Array.isArray(validatedCuts) || !validatedCuts.every(cut =>
  typeof cut.start === "string" &&
  typeof cut.end === "string" &&
  typeof cut.reason === "string" &&
  typeof cut.confidence === "number"
)) {
  logger.warn("⚠️ Safety Net output invalid — running Layer 3 repair on Safety Net result.");
  validatedCuts = await layer3TranslateToValidJSON(validatedCutsRaw, cutsWithSafetyContext);

  logger.info("🔍 Safety Net after Layer 3 repair:", JSON.stringify(validatedCuts, null, 2));
  logger.info("🔍 Schema validation after repair:",
    Array.isArray(validatedCuts) && validatedCuts.every(cut =>
      typeof cut.start === "string" &&
      typeof cut.end === "string" &&
      typeof cut.reason === "string" &&
      typeof cut.confidence === "number"
    ) ? "✅ VALID" : "❌ STILL INVALID"
  );
}

    const cleaned = validatedCutsRaw.replace(/```json|```/g, '').trim();
    parsedSafetyNet = safeParseJSON(cleaned, null);

validatedCuts = (parsedSafetyNet && Array.isArray(parsedSafetyNet.cuts))
  ? parsedSafetyNet.cuts
  : [];

logger.info("🔍 Safety Net raw parsed object:", JSON.stringify(parsedSafetyNet, null, 2));
logger.info("🔍 Safety Net schema validation:",
  Array.isArray(validatedCuts) && validatedCuts.every(cut =>
    typeof cut.start === "string" &&
    typeof cut.end === "string" &&
    typeof cut.reason === "string" &&
    typeof cut.confidence === "number"
  ) ? "✅ VALID" : "❌ INVALID"
);

// 🔄 Auto-repair Safety Net output via Layer 3 if schema invalid
if (!Array.isArray(validatedCuts) || !validatedCuts.every(cut =>
  typeof cut.start === "string" &&
  typeof cut.end === "string" &&
  typeof cut.reason === "string" &&
  typeof cut.confidence === "number"
)) {
  logger.warn("⚠️ Safety Net output invalid — running Layer 3 repair on Safety Net result.");
  validatedCuts = await layer3TranslateToValidJSON(cleaned, cutsWithSafetyContext);

  logger.info("🔍 Safety Net after Layer 3 repair:", JSON.stringify(validatedCuts, null, 2));
  logger.info("🔍 Schema validation after repair:",
    Array.isArray(validatedCuts) && validatedCuts.every(cut =>
      typeof cut.start === "string" &&
      typeof cut.end === "string" &&
      typeof cut.reason === "string" &&
      typeof cut.confidence === "number"
    ) ? "✅ VALID" : "❌ STILL INVALID"
  );
}


// 🔄 NEW: Auto-repair Safety Net output via Layer 3 if schema invalid
if (!Array.isArray(validatedCuts) || !validatedCuts.every(cut =>
  typeof cut.start === "string" &&
  typeof cut.end === "string" &&
  typeof cut.reason === "string" &&
  typeof cut.confidence === "number"
)) {
  logger.warn("⚠️ Safety Net output invalid — running Layer 3 repair on Safety Net result.");
  validatedCuts = await layer3TranslateToValidJSON(cleaned, cutsWithSafetyContext);
}




    if (Array.isArray(validatedCuts) && validatedCuts.length > 0) {
      // Filter GPT-approved cuts against real wordless-time ranges
      validatedCuts = validatedCuts.filter(cut => {
        if (/(dead-air|pause)/i.test(cut.reason)) {
          const cutStart = toSeconds(cut.start);
          const cutEnd = toSeconds(cut.end);
          const cutDur = cutEnd - cutStart;
      
          // Require ≥80% overlap with detected silent ranges
          let maxOverlap = 0;
          for (const wr of wordlessRanges) {
            const overlap = Math.max(0, Math.min(cutEnd, wr.end) - Math.max(cutStart, wr.start));
            if (overlap > maxOverlap) maxOverlap = overlap;
          }
          const overlapRatio = cutDur > 0 ? (maxOverlap / cutDur) : 0;
          if (overlapRatio < 0.5) {
            logger.warn(`❌ Rejected dead-air cut ${cut.start}-${cut.end} — only ${(overlapRatio*100).toFixed(1)}% overlap with wordless time`);
            return false;
          }
      
          // LOCAL_MODE only — check background sound
          if (process.env.LOCAL_MODE === "true") {
            const audioPath = path.resolve(__dirname, "..", "test-assets", `mp4/${base}.mp4`);
            const hasSound = !isMostlySilent(audioPath, cutStart, cutEnd);
            if (hasSound) {
              logger.warn(`❌ Rejected dead-air cut ${cut.start}-${cut.end} — contains background sound`);
              return false;
            }
          }
        }
        return true; // ✅ This was missing
      });
      // Remove any cut that contains at least one non-filler word
const FILLERS = ["uh","um","ah","er","mm","you know","like","sort of","kind of","okay so","right?","i mean","well","actually","basically","literally","honestly","essentially","anyway","so"];
validatedCuts = validatedCuts.filter(cut => {
  const cutStart = toSeconds(cut.start);
  const cutEnd = toSeconds(cut.end);
  const segWords = structuredWords.filter(w => w.start >= cutStart && w.end <= cutEnd);
  if (segWords.length === 0) {
    logger.warn(`⚠️ Empty segment for ${cut.start}-${cut.end} — discarding`);
    return false;
  }
  const hasNonFiller = segWords.some(w => !FILLERS.includes(w.word.toLowerCase().trim()));
  
  if (hasNonFiller) {
    logger.warn(`❌ Rejected cut ${cut.start}-${cut.end} — contains non-filler speech: ${segWords.map(w => w.word).join(" ")}`);
    return false;
  }
  return true;
});

      const rejectedCuts = cutRanges.filter(
        c => !validatedCuts.some(v => v.start === c.start && v.end === c.end)
      );
      logger.info(`✅ Safety net reduced cuts from ${cutRanges.length} to ${validatedCuts.length}`);
      
      if (rejectedCuts.length > 0) {
        logger.info("🧐 Safety net rejected cuts:");
        rejectedCuts.forEach(rc => {
          const matchInGPT = (validatedCuts.gptReasons || []).find(
            r => r.start === rc.start && r.end === rc.end
          );
          if (matchInGPT) {
            logger.info(`   ❌ ${rc.start}–${rc.end} (${rc.reason}) → GPT reason: ${matchInGPT.reason}`);
          } else {
            logger.info(`   ❌ ${rc.start}–${rc.end} (${rc.reason}) → GPT reason: Not explicitly given`);
          }
        });
      }
    
      logger.info("🔍 After safety net validation — kept cuts:", JSON.stringify(validatedCuts, null, 2));

// 📊 Confidence Histogram AFTER Safety Net
const confBucketsAfter = {};
validatedCuts.forEach(cut => {
  const bucket = Math.floor((cut.confidence || 0) * 10) / 10;
  confBucketsAfter[bucket] = (confBucketsAfter[bucket] || 0) + 1;
});
logger.info("📊 Confidence Score Histogram (After Safety Net):", confBucketsAfter);

// 📋 Track reasons for low-confidence cuts (after safety net)
const lowConfidenceReasonsAfter = {};
validatedCuts.forEach(cut => {
  if (cut.confidence !== null && cut.confidence < 0.85) {
    const reasonKey = cut.reason.toLowerCase().trim();
    lowConfidenceReasonsAfter[reasonKey] = (lowConfidenceReasonsAfter[reasonKey] || 0) + 1;
  }
});
logger.info("📋 Low Confidence Reasons (After Safety Net):", lowConfidenceReasonsAfter);

// 🚀 Auto-bump after safety net too
const SAFE_CONFIDENCE_REASONS_AFTER = ["long pause", "dead-air", "silence"];
validatedCuts = validatedCuts.map(cut => {
  const loweredReason = cut.reason.toLowerCase();
  if (SAFE_CONFIDENCE_REASONS_AFTER.some(r => loweredReason.includes(r))) {
    if (cut.confidence < 0.9) {
      logger.info(`⬆️ Bumping confidence (after safety net) for "${cut.reason}" from ${cut.confidence} → 0.95`);
      return { ...cut, confidence: 0.95 };
    }
  }
  return cut;
});

// Preserve context from Safety Net for downstream logging/debug
cutRanges = validatedCuts.map(cut => ({
  ...cut,
  context: getCutContextForSafety(cut)
}));





      // === VERIFY AUDIO SILENCE FOR WORDLESS CUTS ===
if (process.env.LOCAL_MODE === "true") {
  const { resolve } = await import("path");
  const audioPath = resolve(__dirname, "..", "test-assets", `mp4/${base}.mp4`);
  logger.info(`🔍 Running waveform silence verification on ${audioPath}`);

  cutRanges = cutRanges.filter(cut => {
    if (/(dead-air|pause|wordless)/i.test(cut.reason)) {
      const startSec = toSeconds(cut.start);
      const endSec = toSeconds(cut.end);
      const silent = isMostlySilent(audioPath, startSec, endSec);
      if (!silent) {
        logger.warn(`❌ Rejected cut ${cut.start}-${cut.end} — audio not fully silent`);
        return false;
      }
    }
    return true;
  });
} else {
  logger.warn("⚠️ Skipping waveform silence verification in cloud mode (requires ffmpeg build)");
}


      // === FINAL POLISH: Merge for natural pacing ===
if (cutRanges.length > 1) {
  const pacingPrompt = `
You are adjusting a cut list for natural pacing in a spoken video.
Rules:
1. Look for cuts where the next cut starts less than 2.0 seconds after the previous cut ends.
2. Merge such cuts if merging will:
   - Maintain conversational rhythm
   - Avoid jump cuts or abrupt starts
   - Not remove meaningful speech between them
3. When merging, keep the earliest start time and latest end time of the merged group.
4. Optionally extend start/end by up to 0.15 seconds if it improves breath or flow.
5. Do NOT introduce any new cuts; only merge existing ones.
6. Keep output sorted by start time and non-overlapping.
7. Never create a merged cut longer than 5.0 seconds unless the reason includes "long pause" or "silence".
`;


  try {
    let { output: pacingCutsRaw } = await callOpenAI(apiKey, pacingPrompt);
    const pacingCuts = JSON.parse(pacingCutsRaw);
    if (Array.isArray(pacingCuts) && pacingCuts.length > 0) {
      logger.info(`🎯 Pacing merge adjusted cuts from ${cutRanges.length} to ${pacingCuts.length}`);
      cutRanges = pacingCuts;
    } else {
      logger.warn("⚠️ Pacing merge returned no cuts — keeping validated list");
    }
  } catch (err) {
    logger.error("⚠️ Pacing merge GPT step failed:", err);
  }
}

    } else {
      logger.warn("⚠️ Safety net returned no cuts — keeping original cut list");
    }
    
    
  } catch (err) {
    logger.error("⚠️ Safety net GPT validation failed:", err);
  }

// Build final markdown
const cleanedMd = `### PolishedTranscript\n${fullPolishedTranscript.trim()}\n\n### TimestampsToCut\n` +
  (cutRanges.length ? cutRanges.map(c => `- ${c.start}–${c.end} (${c.reason})`).join("\n") : "- None");


      if (process.env.LOCAL_MODE === "true") {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { resolve, dirname } = await import("path");
        const localPath = resolve(__dirname, "..", "test-assets", polishedKey);
        mkdirSync(dirname(localPath), { recursive: true });
        writeFileSync(localPath, cleanedMd);
      } else {
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: polishedKey,
          Body: cleanedMd,
          ContentType: "text/markdown"
        }));
      }
      
      // 🚨 Final safeguard — remove zero/negative-length cuts
cutRanges = cutRanges.filter(cut => {
  const dur = toSeconds(cut.end) - toSeconds(cut.start);
  if (dur <= 0) {
    logger.warn(`⚠️ Dropping invalid cut before save: ${cut.start} → ${cut.end} (${cut.reason})`);
    return false;
  }
  return true;
});

// === FINAL FAIL-SAFE VALIDATION ===
// finalFailSafe function moved to top level

// Detect video duration from structuredWords
const vidDuration = structuredWords.length ? structuredWords[structuredWords.length - 1].end : 0;
cutRanges = finalFailSafe(cutRanges, vidDuration);

      const cutPlanJson = JSON.stringify({
        source: `mp4/${base}.mp4`,
        output: `${base}.final.mp4`,
        cuts: cutRanges
      }, null, 2);
      
      if (process.env.LOCAL_MODE === "true") {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { resolve, dirname } = await import("path");
        const localPath = resolve(__dirname, "..", "test-assets", cutplanKey);
        mkdirSync(dirname(localPath), { recursive: true });
        writeFileSync(localPath, cutPlanJson);
      } else {
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: cutplanKey,
          Body: cutPlanJson,
          ContentType: "application/json"
        }));
      }
      

      logger.info("📦 FINAL cutRanges to output:", JSON.stringify(cutRanges, null, 2));
      logger.info(`✅ SmartCutPlanner output saved for: ${base}`);
      
    } catch (err) {
      logger.error("🔥 SmartCutPlanner failed:", err);
    }
};






function toSeconds(ts) {
  if (typeof ts !== "string" && typeof ts !== "number") return 0;
  ts = String(ts).trim();

  let sec = 0;

  // If it's pure seconds like "8.98" or "12"
  if (/^\d+(\.\d+)?$/.test(ts)) {
    sec = parseFloat(ts);
  }
  // If it's mm:ss(.sss) format
  else if (/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/.test(ts)) {
    const mmssMatch = ts.match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
    const minutes = parseInt(mmssMatch[1], 10);
    const seconds = parseFloat(mmssMatch[2]);
    sec = minutes * 60 + seconds;
  }
  // If it's hh:mm:ss(.sss) format
  else if (/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.test(ts)) {
    const hhmmssMatch = ts.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    const hours = parseInt(hhmmssMatch[1], 10);
    const minutes = parseInt(hhmmssMatch[2], 10);
    const seconds = parseFloat(hhmmssMatch[3]);
    sec = hours * 3600 + minutes * 60 + seconds;
  }
  // Fallback — try parseFloat
  else {
    sec = parseFloat(ts) || 0;
  }

  return parseFloat(sec.toFixed(3)); // ✅ Always return a number
}


function extractWordData(json) {
  if (Array.isArray(json.words) && json.words.length > 0) {
    logger.info(`📦 Found ${json.words.length} words in top-level words[]`);
    return json.words
      .filter(w => w.start !== undefined && w.end !== undefined && w.word)
      .map(w => ({
        start: parseFloat(Number(w.start).toFixed(2)),
        end: parseFloat(Number(w.end).toFixed(2)),
        word: String(w.word)
      }));
  }

  if (Array.isArray(json.segments) && json.segments.length > 0) {
    const recoveredWords = json.segments.flatMap(seg =>
      Array.isArray(seg.words)
        ? seg.words
            .filter(w => w.start !== undefined && w.end !== undefined && w.word)
            .map(w => ({
              start: parseFloat(Number(w.start).toFixed(2)),
              end: parseFloat(Number(w.end).toFixed(2)),
              word: String(w.word)
            }))
        : []
    );
    if (recoveredWords.length > 0) {
      logger.warn(`⚠️ Recovered ${recoveredWords.length} words from segments[].words[]`);
      return recoveredWords;
    }
  }

  logger.warn("⚠️ No word-level data found in transcript JSON");
  return [];
}

function extractTimestamps(md) {
  const results = [];
  const sectionMatch = md.match(/(###\s*TimestampsToCut|###\s*Timestamps|\n-)/i);
  if (!sectionMatch) return results;

  const lines = md.slice(sectionMatch.index).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^none$/i.test(line)) break;

    // Accept either pure seconds or mm:ss(.ss) format
    const match = line.match(
      /^-?\s*(\d+(?:\.\d+)?|\d{1,2}:\d{2}(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?|\d{1,2}:\d{2}(?:\.\d+)?)\s*\(([^)]+)\)/i
    );

    if (match) {
      results.push({
        start: match[1],
        end: match[2],
        reason: match[3]
      });
    } else {
      logger.warn("❌ Could not parse line in TimestampsToCut:", line);
    }
  }
  return results;
}


async function callOpenAI(apiKey, prompt) {
  let messages;
if (typeof prompt === "object" && prompt.system && prompt.user) {
  messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user }
  ];
} else {
  messages = [
    { role: "system", content: "You are a professional podcast video editor. Your job is to detect precise, cut-worthy moments in transcripts." },
    { role: "user", content: String(prompt) }
  ];
}

const data = JSON.stringify({
  model: "gpt-4o",
  max_tokens: 8000,
  temperature: 0.2,
  messages
});


  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        let parsed, output = "", usage;
        try {
          parsed = JSON.parse(body);
          output = parsed?.choices?.[0]?.message?.content || "";
          usage = parsed?.usage;
        } catch (e) {
          logger.error("⚠️ Failed to parse OpenAI response JSON");
        }
        resolve({ output, usage, rawBody: body });
      });
    });

    req.on("error", (err) => {
      logger.error("❌ OpenAI API request failed:", err);
      resolve({ output: "", usage: null, rawBody: "" });
    });

    req.write(data);
    req.end();
  });
  
}

function safeParseJSON(raw, fallback = []) {
  if (!raw || typeof raw !== "string") return fallback;

  // Extract only JSON between markers if present
  let extracted = raw;
  const markerMatch = raw.match(/###JSON_START([\s\S]*?)###JSON_END/);
  if (markerMatch) extracted = markerMatch[1];

  // Remove markdown fences and stray text
  extracted = extracted.replace(/```json|```/g, "").trim();

  // Attempt to fix common JSON issues
  extracted = extracted
    .replace(/,\s*}/g, "}") // trailing commas before }
    .replace(/,\s*]/g, "]"); // trailing commas before ]

  try {
    return JSON.parse(extracted);
  } catch {
    // Last resort: find outermost braces
    const match = extracted.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
  }

  return fallback;
}

function isMostlySilent(audioPath, startSec, endSec) {
  try {
    const cmd = `ffmpeg -hide_banner -loglevel error -ss ${startSec} -to ${endSec} -i "${audioPath}" -af silencedetect=noise=-35dB:d=0.2 -f null - 2>&1`;
    const output = execSync(cmd, { encoding: "utf8" });
    
    // If ffmpeg detected a silence_end event, then there was non-silent audio in the range
    const nonSilentDetected = output.split("\n").some(line => /silence_end/.test(line));

    return !nonSilentDetected; // true = silent, false = not silent
  } catch (err) {
    logger.warn(`⚠️ Audio silence check failed for ${startSec}-${endSec}:`, err.message);
    // Fail-safe: treat as not silent to avoid accidental over-cut
    return false;
  }
}