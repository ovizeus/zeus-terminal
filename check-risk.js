const c = require('fs').readFileSync('c:/Users/ZeuS/zeus-terminal/public/js/trading/risk.js', 'utf8');
const lines = c.split('\n');

// Find duplicate functions
const seen = {};
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  const m = t.match(/^function\s+(\w+)/);
  if (m) {
    if (seen[m[1]] !== undefined) console.log('DUPE:', m[1], 'at', seen[m[1]] + 1, 'and', i + 1);
    seen[m[1]] = i;
  }
}

// Brace depth
let d = 0;
for (const line of lines) {
  for (const ch of line) {
    if (ch === '{') d++;
    if (ch === '}') d--;
  }
}
console.log('depth:', d, 'lines:', lines.length);
