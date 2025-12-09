#!/usr/bin/env node

/**
 * Complexity Checker Script
 *
 * Enforces KISS principle by checking:
 * - Cyclomatic complexity (max: 10)
 * - File size (max: 300 lines)
 * - Function size (max: 50 lines)
 *
 * Part of SSOT/DRY/KISS enforcement system.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPLEXITY_LIMIT = 10;
const MAX_FILE_LINES = 300;
const MAX_FUNCTION_LINES = 50;
const SRC_DIR = join(__dirname, '..', 'src');

// Legacy files being refactored - warnings only
const LEGACY_FILES = [
  'src/parsers/xml/toolCallParser.ts',
  'src/parsers/xml/xmlUtils.ts',
  'src/handlers/stream/formatConvertingStreamProcessor.ts',
  'src/handlers/stream/openaiStreamProcessor.ts',
  'src/handlers/stream/ollamaStreamProcessor.ts',
  'src/translation/converters/ollama.ts',
  'src/translation/engine/translator.ts',
  'src/services/modelService.ts',
  'src/services/translationService.ts',
];

const violations = [];
const warnings = [];

function getAllTsFiles(dir) {
  const files = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory() && !item.startsWith('.') && item !== 'test' && item !== 'node_modules') {
      files.push(...getAllTsFiles(fullPath));
    } else if (item.endsWith('.ts') && !item.endsWith('.d.ts') && !item.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function isLegacyFile(filePath) {
  const relativePath = relative(join(__dirname, '..'), filePath);
  return LEGACY_FILES.some(legacy => relativePath.includes(legacy.replace(/\//g, '\\')));
}

function countLines(content) {
  return content.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('//');
  }).length;
}

function checkFileSize(filePath, content) {
  const lines = countLines(content);
  const isLegacy = isLegacyFile(filePath);

  if (lines > MAX_FILE_LINES) {
    const violation = {
      type: 'file-size',
      file: relative(SRC_DIR, filePath),
      value: lines,
      limit: MAX_FILE_LINES,
      message: `File exceeds ${MAX_FILE_LINES} lines (${lines} lines)`
    };

    if (isLegacy) {
      warnings.push(violation);
    } else {
      violations.push(violation);
    }
  }
}

function checkFunctionSize(filePath, content) {
  const lines = content.split('\n');
  const isLegacy = isLegacyFile(filePath);

  let inFunction = false;
  let functionStart = 0;
  let functionName = '';
  let braceDepth = 0;
  let functionLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Detect function start
    if (!inFunction && (
      trimmed.includes('function ') ||
      /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*{/.test(line) ||
      /^\s*(public|private|protected)\s+(async\s+)?(\w+)\s*\([^)]*\)\s*{/.test(line)
    )) {
      inFunction = true;
      functionStart = i;
      functionName = trimmed.match(/(\w+)\s*\(/)?.[1] || 'anonymous';
      functionLines = [line];
      braceDepth = 0;
    }

    if (inFunction) {
      if (i > functionStart) {
        functionLines.push(line);
      }

      // Count braces
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Function ended
      if (braceDepth === 0 && line.includes('}')) {
        const nonEmptyLines = functionLines.filter(l => {
          const t = l.trim();
          return t.length > 0 && !t.startsWith('//');
        }).length;

        if (nonEmptyLines > MAX_FUNCTION_LINES) {
          const violation = {
            type: 'function-size',
            file: relative(SRC_DIR, filePath),
            function: functionName,
            line: functionStart + 1,
            value: nonEmptyLines,
            limit: MAX_FUNCTION_LINES,
            message: `Function '${functionName}' exceeds ${MAX_FUNCTION_LINES} lines (${nonEmptyLines} lines)`
          };

          if (isLegacy) {
            warnings.push(violation);
          } else {
            violations.push(violation);
          }
        }

        inFunction = false;
        functionLines = [];
      }
    }
  }
}

function estimateComplexity(filePath, content) {
  const isLegacy = isLegacyFile(filePath);
  const complexityPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]+\s*:/g,  // ternary
    /&&/g,
    /\|\|/g,
  ];

  const lines = content.split('\n');
  let inFunction = false;
  let functionStart = 0;
  let functionName = '';
  let functionContent = '';
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect function start
    if (!inFunction && (
      trimmed.includes('function ') ||
      /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*{/.test(line) ||
      /^\s*(public|private|protected)\s+(async\s+)?(\w+)\s*\([^)]*\)\s*{/.test(line)
    )) {
      inFunction = true;
      functionStart = i;
      functionName = trimmed.match(/(\w+)\s*\(/)?.[1] || 'anonymous';
      functionContent = line;
      braceDepth = 0;
    }

    if (inFunction) {
      if (i > functionStart) {
        functionContent += '\n' + line;
      }

      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      if (braceDepth === 0 && line.includes('}')) {
        // Calculate complexity
        let complexity = 1; // Base complexity
        for (const pattern of complexityPatterns) {
          const matches = functionContent.match(pattern);
          if (matches) {
            complexity += matches.length;
          }
        }

        if (complexity > COMPLEXITY_LIMIT) {
          const violation = {
            type: 'complexity',
            file: relative(SRC_DIR, filePath),
            function: functionName,
            line: functionStart + 1,
            value: complexity,
            limit: COMPLEXITY_LIMIT,
            message: `Function '${functionName}' has cyclomatic complexity ${complexity} (limit: ${COMPLEXITY_LIMIT})`
          };

          if (isLegacy) {
            warnings.push(violation);
          } else {
            violations.push(violation);
          }
        }

        inFunction = false;
        functionContent = '';
      }
    }
  }
}

console.log('🔍 Analyzing code complexity...\n');

try {
  const files = getAllTsFiles(SRC_DIR);

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    checkFileSize(file, content);
    checkFunctionSize(file, content);
    estimateComplexity(file, content);
  }

  // Report warnings
  if (warnings.length > 0) {
    console.log('⚠️  Legacy file warnings (will become errors after refactoring):\n');
    for (const w of warnings) {
      console.log(`  ${w.type}: ${w.file}`);
      if (w.function) {
        console.log(`    Function: ${w.function} (line ${w.line})`);
      }
      console.log(`    ${w.value} > ${w.limit} (limit)\n`);
    }
  }

  // Report violations
  if (violations.length > 0) {
    console.log('❌ Complexity violations found:\n');
    for (const v of violations) {
      console.log(`  ${v.type}: ${v.file}`);
      if (v.function) {
        console.log(`    Function: ${v.function} (line ${v.line})`);
      }
      console.log(`    ${v.value} > ${v.limit} (limit)\n`);
    }
    console.log(`\nTotal violations: ${violations.length}`);
    console.log(`Total warnings: ${warnings.length}`);
    process.exit(1);
  }

  console.log('✅ All complexity checks passed!');
  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} warnings in legacy files (will be fixed in Week 3-4)`);
  }
} catch (error) {
  console.error('❌ Error running complexity analysis:', error.message);
  process.exit(1);
}
