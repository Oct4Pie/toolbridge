#!/usr/bin/env node

/**
 * Automated fix for TS4111 errors (index signature access)
 * Converts obj.property → obj['property'] for properties from index signatures
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Get all TS4111 errors
const errors = execSync('npm run type-check 2>&1 || true', { encoding: 'utf-8' });
const lines = errors.split('\n');

const ts4111Errors = [];
for (const line of lines) {
  if (line.includes('error TS4111')) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):/);
    if (match) {
      const [, filePath, lineNum, colNum] = match;
      const propMatch = line.match(/Property '([^']+)'/);
      if (propMatch) {
        ts4111Errors.push({
          file: filePath,
          line: parseInt(lineNum),
          col: parseInt(colNum),
          property: propMatch[1]
        });
      }
    }
  }
}

console.log(`Found ${ts4111Errors.length} TS4111 errors to fix`);

// Group by file
const fileErrors = {};
for (const error of ts4111Errors) {
  if (!fileErrors[error.file]) {
    fileErrors[error.file] = [];
  }
  fileErrors[error.file].push(error);
}

// Fix each file
let fixedCount = 0;
for (const [filePath, errors] of Object.entries(fileErrors)) {
  try {
    let content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Sort errors by line number (descending) to avoid offset issues
    errors.sort((a, b) => b.line - a.line || b.col - a.col);
    
    for (const error of errors) {
      const lineIdx = error.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) continue;
      
      const line = lines[lineIdx];
      const { property } = error;
      
      // Pattern: something.property → something['property']
      // Be careful with method calls, chaining, etc.
      const dotPropertyPattern = new RegExp(`\\.${property}(?![a-zA-Z0-9_])`, 'g');
      
      // Check if this is a simple property access (not in a string, comment, etc.)
      if (dotPropertyPattern.test(line)) {
        lines[lineIdx] = line.replace(dotPropertyPattern, `['${property}']`);
        fixedCount++;
      }
    }
    
    content = lines.join('\n');
    writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed ${errors.length} errors in ${filePath}`);
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err.message);
  }
}

console.log(`\nTotal fixes applied: ${fixedCount}`);
console.log('Run npm run type-check to verify');
