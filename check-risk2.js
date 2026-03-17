const c = require('fs').readFileSync('c:/Users/ZeuS/zeus-terminal/public/js/trading/risk.js', 'utf8');
const lines = c.split('\n');
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const prev = depth;
  for (const ch of lines[i]) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }
  if (depth < 0) {
    console.log('NEGATIVE at L' + (i+1) + ': depth=' + depth + ': ' + lines[i].substring(0,80));
  }
  if (depth !== prev && (prev === 0 || depth === 0)) {
    console.log('L' + (i+1) + ': ' + prev + '->' + depth + ': ' + lines[i].substring(0,80));
  }
}
console.log('Final depth:', depth, 'Lines:', lines.length);
