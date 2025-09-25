Please can you roast the plan we have for our TalkAvocado POC in WP00 and WP01.

docs/mfu-backlog

The MFUs should include how we best incorporate work that we have already done on the POC in the podcast-automation that we want to correctly incorporate and structure into this project. 

Are the MFUs clear for Agent threads to work on in Cursor and get right first time?

Please identify any areas that you think are incorrect, unneccessarily complex or overengineered or that will be misleading for agent threads to follow and likely to cause issues. 

Please note you are in Ask mode, as I would like a review only, rather than any changes made to MFUs at this stage. 

Please conduct this as a constructive critical peer review of the planned roadmap.

## Initial output

I'll conduct a thorough review of your TalkAvocado POC plan by examining all the MFUs in the docs/mfu-backlog directory. Let me start by reading through all the work packages to understand the complete scope and structure.

[7 tools called]

Now let me read the remaining WP01 MFUs to get the complete picture:

[7 tools called]

Now let me examine the existing podcast-automation code to understand what needs to be migrated:

[2 tools called]

Perfect! Now I have a comprehensive understanding of your TalkAvocado POC plan. Let me provide you with a constructive critical peer review of your MFU roadmap.

# 🥑 TalkAvocado POC Plan Review: Constructive Critical Assessment

## **Overall Architecture Assessment: SOLID Foundation, But Some Concerns**

### ✅ **What's Working Well**

1. **Clear Phase Structure**: The WP00 (Foundations) → WP01 (Pipeline) progression is logical and well-sequenced
2. **Migration Strategy**: Smart approach to preserve existing `exports.handler` signatures while restructuring
3. **Multi-tenancy**: Consistent tenant-scoped storage pattern throughout (`{env}/{tenantId}/{jobId}/`)
4. **Agent-Friendly**: Good step-by-step execution guides and acceptance criteria

### 🔥 **Critical Issues That Will Cause Problems**

## **1. WP00-01 is Dangerously Overloaded** 
**Risk Level: HIGH** 🚨

This MFU tries to do everything at once:
- Repository scaffolding 
- CI setup (Node + Python lanes)
- Environment configuration
- Complete file migration
- Storage abstraction layer
- Test harness conversion

**Problems:**
- **Agent threads will get lost** in the 450-line specification
- **"15-minute setup"** is unrealistic given the scope
- **Dependencies are unclear** - you can't migrate handlers before storage.ts exists
- **Mixed concerns** - infrastructure, migration, and tooling in one MFU

**Recommendation:** Split into 3 MFUs:
- `WP00-01A-IAC: Repository Bootstrap & CI` (just the scaffolding)
- `WP00-01B-BE: Storage Abstraction Layer` (the library code)  
- `WP00-01C-MIG: Handler Migration` (after storage.ts exists)

## **2. Storage Abstraction is Under-Specified**
**Risk Level: HIGH** 🚨

The `backend/lib/storage.ts` is mentioned everywhere but never properly defined:

```typescript
// What does this actually look like?
getBasePath(env, tenantId, jobId) // → string? object?
keyFor(kind) // → what kinds? validation?
```

**Problems:**
- **Every subsequent MFU depends on this** but it's vaguely defined
- **Local vs S3 mapping** logic is handwaved
- **Error handling** not specified
- **Agent threads will implement it differently** each time

**Recommendation:** Provide concrete interface specification:
```typescript
interface StorageAdapter {
  getInputPath(jobId: string): string;
  getAudioPath(jobId: string): string;
  // etc...
}
```

## **3. Manifest Schema Evolution Will Break Everything**
**Risk Level: MEDIUM** 🟡

The manifest is updated by every service, but there's no versioning strategy:

**Problems:**
- **Schema changes will break running jobs**
- **No rollback strategy** if manifest format changes
- **Concurrent updates** not handled (what if two services update simultaneously?)

**Recommendation:** Add explicit versioning and update patterns.

## **4. FFmpeg Runtime is a Hidden Complexity Bomb**
**Risk Level: HIGH** 🚨

WP00-03 casually mentions "FFmpeg Lambda layer or container" but this is actually **very complex**:

**Problems:**
- **FFmpeg builds are platform-specific** and huge (>100MB)
- **Lambda layer size limits** (250MB unzipped)
- **Container images** change deployment model significantly
- **Memory/timeout tuning** is workload-dependent and not predictable
- **Agent threads can't solve this** - requires infrastructure expertise

**Recommendation:** 
- Either commit to containers from day 1, or
- Use pre-built FFmpeg layer (like `serverless-ffmpeg`) and document limitations

## **5. Test Strategy is Backwards**
**Risk Level: MEDIUM** 🟡

WP00-05 creates test harness **before** the services work, but WP01 services need the harness to validate:

**Problems:**
- **Circular dependency**: harness needs working services, services need harness for testing
- **Golden samples** are defined before you know what "good" output looks like
- **Deterministic mode** for AI planner is complex and may not be realistic

**Recommendation:** Create minimal smoke tests first, full harness after basic pipeline works.

## **6. Video Engine Complexity is Underestimated**  
**Risk Level: HIGH** 🚨

WP01-04 and WP01-05 are marked "Medium" complexity but involve:

**Frame-accurate cuts:**
- Keyframe alignment issues
- GOP structure handling
- Variable frame rate content

**A/V sync validation:**
- How do you measure "50ms drift"? 
- What's the detection algorithm?
- How do you handle content that's already out of sync?

**Transitions:**
- FFmpeg filtergraph complexity
- Memory usage for crossfades
- Maintaining quality through multiple encodes

**Problems:**
- **2-day estimates are wildly optimistic**
- **Agent threads will struggle** with video encoding nuances
- **No fallback strategy** if precision requirements can't be met

**Recommendation:** Start with "good enough" cuts (nearest keyframe) and evolve.

## **7. Missing Critical Error Scenarios**

Your MFUs don't address:
- **What happens when FFmpeg fails?** (corrupted input, unsupported codec)
- **What happens when transcription is empty?** (silent video, non-English)
- **What happens when cut plan is invalid?** (no segments to keep)
- **How do you handle partial failures?** (audio extracted but transcription fails)

## **Agent Thread Readiness Assessment**

### 🟢 **Agent-Friendly MFUs:**
- WP00-02 (Manifest Schema) - well-defined, clear outputs
- WP01-01 (Audio Extraction) - straightforward, existing code
- WP01-02 (Transcription) - clear inputs/outputs

### 🟡 **Challenging for Agents:**
- WP00-04 (Orchestration) - requires understanding state machines
- WP01-03 (Smart Cut Planner) - deterministic AI is hard
- WP01-06 (Subtitle Retiming) - complex timestamp math

### 🔴 **Will Likely Fail:**
- WP00-01 (too broad, mixed concerns)
- WP00-03 (infrastructure complexity)
- WP01-04/05 (video encoding expertise required)

## **Incorporating Existing Work**

### ✅ **Good Migration Strategy:**
- Preserving `exports.handler` signatures
- Maintaining local mode for testing
- Gradual path abstraction

### 🔴 **Missing Considerations:**
- **Dependency management**: existing modules have different package.json files
- **Environment variables**: current code uses different env var names
- **Error handling patterns**: existing code has inconsistent error handling
- **Logging**: current console.log vs structured logging transition

## **Recommendations for Success**

### 1. **Reduce Scope of WP00-01**
Split the mega-MFU into focused, sequential tasks.

### 2. **Define Storage Interface First**
Create a detailed interface specification before any migration.

### 3. **Start with "Good Enough" Video Processing**
Don't aim for frame-perfect initially - get the pipeline working end-to-end first.

### 4. **Add Explicit Error Handling MFU**
Create a dedicated MFU for error scenarios and recovery patterns.

### 5. **Realistic Complexity Assessment**
- Video processing: HIGH complexity, 3-5 days each
- Infrastructure: MEDIUM-HIGH complexity  
- Schema/API work: LOW-MEDIUM complexity

### 6. **Agent Execution Guides Need Examples**
Instead of "Implement X", provide:
```bash
# Create this file with this content
# Run this command
# Expect this output
```

## **Final Verdict**

**Foundation (WP00)**: The concept is sound but WP00-01 will cause significant delays and confusion. The storage abstraction is critical and under-specified.

**Pipeline (WP01)**: Reasonable progression, but video processing complexity is underestimated. The existing podcast-automation code provides a good starting point.

**Agent Readiness**: About 60% of MFUs are suitable for agent execution. The rest need more detailed specifications or human expertise.

**Overall**: This is a solid plan that needs **tactical refinement** rather than strategic changes. Focus on breaking down the complex MFUs and providing more concrete specifications for the infrastructure components.

The existing podcast-automation code is actually quite sophisticated and well-structured - you're in a good position to build on it. Just don't underestimate the video processing complexity! 🎬