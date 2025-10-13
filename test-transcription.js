// Simple test script for transcription handler
import { handler } from './backend/services/transcription/handler.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function testTranscription() {
  // Create a simple test audio file (silence for 2 seconds)
  const testDir = 'storage/dev/t-test/test-job';
  mkdirSync(testDir, { recursive: true });
  
  // Create a simple test manifest
  const manifest = {
    schemaVersion: '1.0.0',
    env: 'dev',
    tenantId: 't-test',
    jobId: 'test-job',
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audio: {
      key: 'dev/t-test/test-job/audio/test-job.mp3'
    }
  };
  
  writeFileSync(join(testDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  
  // Create a simple silent MP3 file (2 seconds of silence)
  // This is a minimal MP3 header + silence
  const mp3Data = Buffer.from([
    0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);
  
  const audioDir = join(testDir, 'audio');
  mkdirSync(audioDir, { recursive: true });
  writeFileSync(join(audioDir, 'test-job.mp3'), mp3Data);
  
  // Test the handler
  const event = {
    env: 'dev',
    tenantId: 't-test',
    jobId: 'test-job',
    audioKey: 'dev/t-test/test-job/audio/test-job.mp3',
    correlationId: 'test-correlation-id'
  };
  
  const context = {
    awsRequestId: 'test-request-id'
  };
  
  try {
    console.log('Testing transcription handler...');
    const result = await handler(event, context);
    console.log('Transcription completed successfully:', result);
  } catch (error) {
    console.error('Transcription failed:', error.message);
    console.error('Error type:', error.type);
    console.error('Error details:', error.details);
  }
}

testTranscription();
