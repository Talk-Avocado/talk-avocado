#!/usr/bin/env node
// test-smart-cut-planner.js
import { handler } from './backend/services/smart-cut-planner/handler.js';
import { keyFor, pathFor, ensureDirForFile } from './backend/dist/storage.js';
import { saveManifest } from './backend/dist/manifest.js';
import fs from 'node:fs';
// path import removed as it's not used

async function testSmartCutPlanner() {
  const env = 'dev';
  const tenantId = 't-test';
  const jobId = 'test-smart-cut-planner';
  
  console.log('Testing Smart Cut Planner...');
  
  // 1. Create test transcript
  const transcriptKey = keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json');
  const transcriptPath = pathFor(transcriptKey);
  ensureDirForFile(transcriptPath);
  
  const testTranscript = {
    "text": "This is a sample transcript for testing the harness. It contains about forty-five words to match the expected word count in the metrics. The transcript should be processed correctly by the transcription service and then used by the smart cut planner.",
    "segments": [
      {
        "id": 0,
        "start": 0.0,
        "end": 5.5,
        "text": "This is a sample transcript for testing the harness.",
        "words": [
          { "start": 0.0, "end": 0.5, "text": "This" },
          { "start": 0.5, "end": 0.8, "text": "is" },
          { "start": 0.8, "end": 1.0, "text": "a" },
          { "start": 1.0, "end": 1.5, "text": "sample" },
          { "start": 1.5, "end": 2.2, "text": "transcript" },
          { "start": 2.2, "end": 2.5, "text": "for" },
          { "start": 2.5, "end": 3.0, "text": "testing" },
          { "start": 3.0, "end": 3.2, "text": "the" },
          { "start": 3.2, "end": 4.0, "text": "harness" }
        ]
      },
      {
        "id": 1,
        "start": 7.0,
        "end": 12.0,
        "text": "It contains about forty-five words to match the expected word count.",
        "words": [
          { "start": 7.0, "end": 7.2, "text": "It" },
          { "start": 7.2, "end": 7.8, "text": "contains" },
          { "start": 7.8, "end": 8.2, "text": "about" },
          { "start": 8.2, "end": 8.8, "text": "forty-five" },
          { "start": 8.8, "end": 9.2, "text": "words" },
          { "start": 9.2, "end": 9.5, "text": "to" },
          { "start": 9.5, "end": 10.0, "text": "match" },
          { "start": 10.0, "end": 10.2, "text": "the" },
          { "start": 10.2, "end": 10.8, "text": "expected" },
          { "start": 10.8, "end": 11.2, "text": "word" },
          { "start": 11.2, "end": 11.8, "text": "count" }
        ]
      },
      {
        "id": 2,
        "start": 14.0,
        "end": 18.5,
        "text": "The transcript should be processed correctly by the transcription service.",
        "words": [
          { "start": 14.0, "end": 14.2, "text": "The" },
          { "start": 14.2, "end": 14.8, "text": "transcript" },
          { "start": 14.8, "end": 15.2, "text": "should" },
          { "start": 15.2, "end": 15.5, "text": "be" },
          { "start": 15.5, "end": 16.2, "text": "processed" },
          { "start": 16.2, "end": 16.8, "text": "correctly" },
          { "start": 16.8, "end": 17.0, "text": "by" },
          { "start": 17.0, "end": 17.2, "text": "the" },
          { "start": 17.2, "end": 18.0, "text": "transcription" },
          { "start": 18.0, "end": 18.5, "text": "service" }
        ]
      },
      {
        "id": 3,
        "start": 20.0,
        "end": 25.0,
        "text": "And then used by the smart cut planner.",
        "words": [
          { "start": 20.0, "end": 20.2, "text": "And" },
          { "start": 20.2, "end": 20.5, "text": "then" },
          { "start": 20.5, "end": 20.8, "text": "used" },
          { "start": 20.8, "end": 21.0, "text": "by" },
          { "start": 21.0, "end": 21.2, "text": "the" },
          { "start": 21.2, "end": 21.6, "text": "smart" },
          { "start": 21.6, "end": 21.8, "text": "cut" },
          { "start": 21.8, "end": 22.5, "text": "planner" }
        ]
      }
    ]
  };
  
  fs.writeFileSync(transcriptPath, JSON.stringify(testTranscript, null, 2));
  console.log(`Created test transcript: ${transcriptKey}`);
  
  // 2. Create initial manifest
  const manifest = {
    schemaVersion: '1.0.0',
    env,
    tenantId,
    jobId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveManifest(env, tenantId, jobId, manifest);
  console.log('Created test manifest');
  
  // 3. Run smart cut planner
  try {
    const event = { env, tenantId, jobId, transcriptKey };
    const context = { awsRequestId: `test-${Date.now()}` };
    
    console.log('Running smart cut planner...');
    const result = await handler(event, context);
    console.log('✓ Smart cut planner completed successfully');
    console.log('Result:', result);
    
    // 4. Check output
    const planKey = keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
    const planPath = pathFor(planKey);
    
    if (fs.existsSync(planPath)) {
      const cutPlan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
      console.log('\nGenerated cut plan:');
      console.log(JSON.stringify(cutPlan, null, 2));
    } else {
      console.log('❌ Cut plan file not found');
    }
    
  } catch (error) {
    console.error('❌ Smart cut planner failed:', error.message);
    console.error('Error details:', error);
  }
}

testSmartCutPlanner().catch(console.error);
