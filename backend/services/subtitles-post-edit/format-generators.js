// backend/services/subtitles-post-edit/format-generators.js

/**
 * Format seconds to SRT timestamp format (HH:MM:SS,mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted timestamp string
 */
function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Format seconds to WebVTT timestamp format (HH:MM:SS.mmm)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted timestamp string
 */
function formatVTTTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Generate SRT (SubRip) format subtitle file content
 * @param {Object} transcript - Transcript object with segments array
 * @returns {string} SRT formatted content
 */
function generateSRT(transcript) {
  if (!transcript || !transcript.segments || !Array.isArray(transcript.segments)) {
    throw new Error('Invalid transcript: missing segments array');
  }

  const lines = [];
  let index = 1;
  
  for (const segment of transcript.segments) {
    const text = (segment.text || '').trim();
    if (!text) continue; // Skip empty segments
    
    const startTime = formatTimestamp(Number(segment.start));
    const endTime = formatTimestamp(Number(segment.end));
    
    lines.push(String(index));
    lines.push(`${startTime} --> ${endTime}`);
    lines.push(text);
    lines.push(''); // Empty line between subtitles
    
    index++;
  }
  
  return lines.join('\n');
}

/**
 * Generate WebVTT format subtitle file content
 * @param {Object} transcript - Transcript object with segments array
 * @returns {string} WebVTT formatted content
 */
function generateVTT(transcript) {
  if (!transcript || !transcript.segments || !Array.isArray(transcript.segments)) {
    throw new Error('Invalid transcript: missing segments array');
  }

  const lines = ['WEBVTT', '']; // WebVTT header
  
  for (const segment of transcript.segments) {
    const text = (segment.text || '').trim();
    if (!text) continue; // Skip empty segments
    
    const startTime = formatVTTTimestamp(Number(segment.start));
    const endTime = formatVTTTimestamp(Number(segment.end));
    
    lines.push(`${startTime} --> ${endTime}`);
    lines.push(text);
    lines.push(''); // Empty line between subtitles
  }
  
  return lines.join('\n');
}

export {
  generateSRT,
  generateVTT,
  formatTimestamp,
  formatVTTTimestamp
};





