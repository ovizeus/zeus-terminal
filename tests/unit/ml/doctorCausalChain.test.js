'use strict';

describe('Doctor D-6: causalChain', () => {
  test('buildBlameTree returns tree with root module', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'serverBrain' });
    expect(tree).toHaveProperty('root', 'serverBrain');
    expect(tree).toHaveProperty('depth');
    expect(tree).toHaveProperty('nodes');
    expect(Array.isArray(tree.nodes)).toBe(true);
  });

  test('buildBlameTree respects maxDepth', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'serverBrain', maxDepth: 1 });
    expect(tree.depth).toBeLessThanOrEqual(1);
  });

  test('buildBlameTree returns empty nodes for unknown module', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'nonexistent_xyz_999' });
    expect(tree.root).toBe('nonexistent_xyz_999');
    expect(tree.nodes.length).toBe(0);
  });

  test('getModuleHealth returns health info', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const health = cc.getModuleHealth({ moduleId: 'serverBrain' });
    expect(health).toHaveProperty('moduleId', 'serverBrain');
    expect(health).toHaveProperty('trustScore');
    expect(health).toHaveProperty('latencyMs');
    expect(health).toHaveProperty('ranOk');
  });

  test('getModuleHealth handles null moduleId', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const health = cc.getModuleHealth({ moduleId: null });
    expect(health.moduleId).toBeNull();
  });
});
