'use strict';

function getTemplate(name) {
  if (name === 'big_house') {
    return buildBigHouse();
  }

  return null;
}

function buildBigHouse() {
  const blocks = [];

  fillBox(blocks, 0, 0, 0, 12, 0, 9, 'oak_planks');

  for (let y = 1; y <= 4; y += 1) {
    wallRing(blocks, 0, y, 0, 12, 9, 'spruce_planks');
  }

  for (let y = 1; y <= 3; y += 1) {
    blocks.push({ x: 0, y, z: 4, block: 'air' });
    blocks.push({ x: 12, y, z: 4, block: 'air' });
  }

  for (let x = 2; x <= 10; x += 4) {
    blocks.push({ x, y: 2, z: 0, block: 'glass_pane' });
    blocks.push({ x, y: 2, z: 9, block: 'glass_pane' });
  }

  for (let z = 2; z <= 7; z += 3) {
    blocks.push({ x: 0, y: 2, z, block: 'glass_pane' });
    blocks.push({ x: 12, y: 2, z, block: 'glass_pane' });
  }

  fillBox(blocks, 0, 5, 0, 12, 5, 9, 'oak_slab');
  fillBox(blocks, 1, 6, 1, 11, 6, 8, 'oak_slab');
  fillBox(blocks, 2, 7, 2, 10, 7, 7, 'oak_slab');

  fillBox(blocks, 1, 1, 1, 11, 1, 8, 'birch_planks');

  blocks.push({ x: 6, y: 1, z: 4, block: 'crafting_table' });
  blocks.push({ x: 5, y: 1, z: 4, block: 'chest' });
  blocks.push({ x: 7, y: 1, z: 4, block: 'furnace' });

  blocks.push({ x: 1, y: 1, z: 4, block: 'oak_door' });
  blocks.push({ x: 1, y: 2, z: 4, block: 'oak_door' });

  return {
    name: 'big_house',
    description: 'Large starter house for creative build tests',
    blocks: normalize(blocks)
  };
}

function wallRing(blocks, x0, y, z0, width, depth, block) {
  for (let x = x0; x <= width; x += 1) {
    blocks.push({ x, y, z: z0, block });
    blocks.push({ x, y, z: depth, block });
  }

  for (let z = z0 + 1; z < depth; z += 1) {
    blocks.push({ x: x0, y, z, block });
    blocks.push({ x: width, y, z, block });
  }
}

function fillBox(blocks, x1, y1, z1, x2, y2, z2, block) {
  for (let x = x1; x <= x2; x += 1) {
    for (let y = y1; y <= y2; y += 1) {
      for (let z = z1; z <= z2; z += 1) {
        blocks.push({ x, y, z, block });
      }
    }
  }
}

function normalize(blocks) {
  const deduped = new Map();

  for (const entry of blocks) {
    deduped.set(`${entry.x}:${entry.y}:${entry.z}`, entry);
  }

  return [...deduped.values()].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
}

module.exports = {
  getTemplate
};
