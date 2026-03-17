// Find brace imbalance in marketData.js
const fs = require('fs');
const c = fs.readFileSync('c:/Users/ZeuS/zeus-terminal/public/js/data/marketData.js', 'utf8');
const lines = c.split('\n');

let depth = 0;
let inString = false;
let strChar = '';
let inTemplate = 0;
let inLineComment = false;
let inBlockComment = false;

for (let i = 0; i < Math.min(lines.length, 1200); i++) {
  const prevDepth = depth;
  const line = lines[i];
  
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    const next = line[j + 1] || '';
    
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; j++; }
      continue;
    }
    if (inLineComment) continue;
    if (ch === '/' && next === '/') { inLineComment = true; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; j++; continue; }
    
    if (inString) {
      if (ch === '\\') { j++; continue; } // skip escaped
      if (ch === strChar) inString = false;
      continue;
    }
    
    if (ch === "'" || ch === '"') { inString = true; strChar = ch; continue; }
    if (ch === '`') { inTemplate += (inTemplate > 0 ? -1 : 1); continue; }
    
    if (inTemplate > 0) {
      if (ch === '\\') { j++; continue; }
      if (ch === '$' && next === '{') { depth++; j++; continue; }
      continue;
    }
    
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  
  inLineComment = false;
  
  if (depth !== prevDepth && (prevDepth === 0 || depth === 0)) {
    console.log(`L${i + 1}: ${prevDepth}->${depth}: ${line.substring(0, 80)}`);
  }
  if (depth < 0) {
    console.log(`NEGATIVE at L${i + 1}: depth=${depth}`);
  }
}

console.log(`\nFinal depth at line ${Math.min(lines.length, 1200)}: ${depth}`);
console.log(`Total lines: ${lines.length}`);
