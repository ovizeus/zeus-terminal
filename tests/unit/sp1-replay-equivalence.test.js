const fs = require('fs');
const path = require('path');
const brain = require('../../server/services/serverBrain');
const fuse = brain.__sp1.fuseDecision;

// Real client-captured vectors if present; otherwise the harness sample.
const realPath = path.join(__dirname, '../fixtures/sp1-fusion-vectors.json');
const samplePath = path.join(__dirname, '../fixtures/sp1-fusion-vectors.sample.json');
const vectorsPath = fs.existsSync(realPath) ? realPath : samplePath;
const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

describe('SP1 replay equivalence: server _fuseDecision == client output', () => {
  test(`fixture present and non-empty (${path.basename(vectorsPath)})`, () => {
    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors.length).toBeGreaterThan(0);
  });

  test('every vector: dir + decision bit-identical; confidence/score exact', () => {
    const EPS = 0; // identical formula → exact
    const mismatches = [];
    for (let i = 0; i < vectors.length; i++) {
      const v = vectors[i];
      const got = fuse(v.input);
      const ok = got.dir === v.output.dir
        && got.decision === v.output.decision
        && Math.abs(got.confidence - v.output.confidence) <= EPS
        && Math.abs(got.score - v.output.score) <= EPS;
      if (!ok) mismatches.push({ i, input: v.input, expected: v.output, got });
    }
    if (mismatches.length) {
      console.error('SP1 replay mismatches:', JSON.stringify(mismatches.slice(0, 10), null, 2));
    }
    expect(mismatches).toEqual([]);
  });
});
