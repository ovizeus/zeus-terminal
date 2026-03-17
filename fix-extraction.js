/**
 * fix-extraction.js — Fix extraction issues:
 * 1. Remove HTML body content from JS files (marketData.js, arianova.js, aub.js)
 * 2. Remove duplicate blocks from overlapping extractions (brain.js, risk.js)
 */
const fs = require('fs');
const path = require('path');

const JS = p => path.join(__dirname, 'public', 'js', p);

// ───────────────────────────────────────────────────────────
// 1. REMOVE HTML BLOCKS FROM JS FILES
// ───────────────────────────────────────────────────────────

function removeHtmlBlocks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const result = [];
  let i = 0;
  let removed = 0;
  
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    
    // Detect start of HTML block: line starts with <tag (not inside a JS expression)
    // Check that previous line is NOT a continuation (no = + ( ` before)
    if (isHtmlLine(trimmed) && !isInsideJsExpression(result)) {
      // Scan forward to find end of HTML block
      let j = i;
      while (j < lines.length && (isHtmlLine(lines[j].trim()) || lines[j].trim() === '' || isHtmlContinuation(lines[j].trim()))) {
        j++;
        // Stop if we hit a JS line
        if (j < lines.length && isJsLine(lines[j].trim())) break;
      }
      const blockSize = j - i;
      if (blockSize > 1) { // Only remove multi-line HTML blocks (not inline HTML in strings)
        console.log(`  Removed HTML block: L${i + 1}-L${j} (${blockSize} lines)`);
        removed += blockSize;
        i = j;
        continue;
      }
    }
    result.push(lines[i]);
    i++;
  }
  
  if (removed > 0) {
    fs.writeFileSync(filePath, result.join('\n'), 'utf8');
    console.log(`  ✓ Removed ${removed} HTML lines from ${path.basename(filePath)}`);
  } else {
    console.log(`  ✓ No HTML blocks found in ${path.basename(filePath)}`);
  }
  return removed;
}

function isHtmlLine(line) {
  if (!line) return false;
  // Lines that start with HTML tags (not template literals or string assignments)
  return /^<\/?(?:div|span|button|input|select|option|label|table|tr|td|th|style|link|meta|section|nav|header|footer|ul|li|ol|a |img|form|br|hr|p |h[1-6])\b/i.test(line);
}

function isHtmlContinuation(line) {
  if (!line) return false;
  // Lines inside HTML blocks: attributes, closing tags, text content within HTML
  return /^<\/?[a-z]/i.test(line) || /^\s*</.test(line) || /^[A-Z][a-z]/.test(line) && !isJsLine(line);
}

function isInsideJsExpression(resultLines) {
  // Check if the last non-empty result line suggests we're inside a JS expression
  for (let i = resultLines.length - 1; i >= 0; i--) {
    const t = resultLines[i].trim();
    if (!t) continue;
    // If last line ends with = + ( ` , we're inside an expression
    return /[=+(`,$]$/.test(t) || /return\s*$/.test(t);
  }
  return false;
}

function isJsLine(line) {
  if (!line) return false;
  return /^(?:\/\/|\/\*|\*|'use strict'|function |const |let |var |if\s*\(|else|for\s*\(|while|try|catch|switch|return |class |import |export |window\.|document\.|console\.|new |throw |typeof |\(function|}\s*(?:else|catch|finally)|})/.test(line);
}

// ───────────────────────────────────────────────────────────
// 2. REMOVE DUPLICATE BLOCKS FROM OVERLAPPING EXTRACTIONS
// ───────────────────────────────────────────────────────────

function removeDuplicateBlocks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Find all function/const/let/var declarations and detect duplicates
  const declarations = new Map(); // signature -> first line index
  const dupeRanges = []; // ranges to remove
  
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // Match function declarations and const/let/var with significant content
    const sig = getFunctionSignature(t);
    if (sig) {
      if (declarations.has(sig)) {
        const firstIdx = declarations.get(sig);
        // This is a duplicate. Find the extent of the duplicate block
        // by matching lines forward from both positions
        let matchLen = 0;
        while (firstIdx + matchLen < i && 
               i + matchLen < lines.length && 
               lines[firstIdx + matchLen] === lines[i + matchLen]) {
          matchLen++;
        }
        if (matchLen > 2) { // Only remove if significant duplicate
          dupeRanges.push({ start: i, end: i + matchLen - 1, matchLen, sig });
          console.log(`  Found duplicate block at L${i + 1} (${matchLen} lines): ${sig.substring(0, 60)}`);
        }
      } else {
        declarations.set(sig, i);
      }
    }
  }
  
  if (dupeRanges.length === 0) {
    console.log(`  ✓ No duplicate blocks in ${path.basename(filePath)}`);
    return 0;
  }
  
  // Remove duplicate ranges (process in reverse to maintain indices)
  const toRemove = new Set();
  dupeRanges.sort((a, b) => b.start - a.start);
  for (const range of dupeRanges) {
    for (let i = range.start; i <= range.end; i++) {
      toRemove.add(i);
    }
  }
  
  const result = lines.filter((_, i) => !toRemove.has(i));
  fs.writeFileSync(filePath, result.join('\n'), 'utf8');
  console.log(`  ✓ Removed ${toRemove.size} duplicate lines from ${path.basename(filePath)}`);
  return toRemove.size;
}

function getFunctionSignature(line) {
  // Match function declarations
  const funcMatch = line.match(/^function\s+(\w+)\s*\(/);
  if (funcMatch) return line;
  // Match assigned functions
  const assignMatch = line.match(/^(?:const|let|var)\s+\w+\s*=\s*function/);
  if (assignMatch) return line;
  return null;
}

// ───────────────────────────────────────────────────────────
// 3. VERIFY BRACE BALANCE
// ───────────────────────────────────────────────────────────

function checkBraceBalance(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Rough brace counting (ignoring strings/comments for speed)
  let depth = 0;
  const lines = content.split('\n');
  for (const line of lines) {
    // Strip strings roughly
    const clean = line.replace(/(?:'[^']*'|"[^"]*"|`[^`]*`)/g, '');
    for (const ch of clean) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
  }
  return depth;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

console.log('═══ FIX EXTRACTION ISSUES ═══\n');

// Step 1: Remove HTML from JS files
console.log('── Step 1: Remove HTML blocks ──');
for (const f of ['data/marketData.js', 'brain/arianova.js', 'brain/aub.js']) {
  console.log(`\n${f}:`);
  removeHtmlBlocks(JS(f));
}

// Step 2: Remove duplicate blocks
console.log('\n── Step 2: Remove duplicate blocks ──');
for (const f of ['brain/brain.js', 'trading/risk.js']) {
  console.log(`\n${f}:`);
  removeDuplicateBlocks(JS(f));
}

// Step 3: Verify brace balance on all fixed files
console.log('\n── Step 3: Brace balance check ──');
const checkFiles = [
  'data/marketData.js', 'brain/arianova.js', 'brain/aub.js',
  'brain/brain.js', 'trading/risk.js', 'core/config.js', 'ui/dom.js'
];
let allOk = true;
for (const f of checkFiles) {
  const depth = checkBraceBalance(JS(f));
  const status = depth === 0 ? '✓' : `✗ (depth=${depth})`;
  console.log(`  ${status} ${f}`);
  if (depth !== 0) allOk = false;
}

if (!allOk) {
  console.log('\n⚠️  Some files still have brace imbalance — may need manual review');
} else {
  console.log('\n✅ All brace balances OK');
}
