#!/usr/bin/env node

import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import {
  clamp01,
  normalize,
  quaternionFromZToNormal,
  rgbToShDc,
  sampleTriangleBarycentric,
  triangleArea,
  triangleNormal,
  weightedVec3
} from './math.js';
import {
  createTextureCache,
  getDecodedTexture,
  sampleTextureRgb
} from './texture.js';
import { writeGaussianPly } from './writeGaussianPly.js';

const DEFAULT_COLOR = [0.5, 0.5, 0.5];
const MIN_RADIUS = 1e-6;

const GLTF_MODE = {
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);

  const io = new NodeIO();
  const document = await io.read(options.inputPath);
  const root = document.getRoot();
  const meshes = root.listMeshes();
  const textureCache = createTextureCache();

  const triangles = collectTriangles(meshes, textureCache);
  const totalArea = triangles.reduce((sum, triangle) => sum + triangle.area, 0);

  if (triangles.length === 0 || totalArea <= 0) {
    throw new Error('No non-degenerate triangles were found in the input mesh.');
  }

  const splats = buildSplats(triangles, totalArea, options);

  await writeGaussianPly(options.outputPath, splats, { format: options.format });

  console.log(`meshes: ${meshes.length}`);
  console.log(`primitives: ${triangles.primitiveCount}`);
  console.log(`triangles: ${triangles.length}`);
  console.log(`total area: ${totalArea}`);
  console.log(`requested maxSplats: ${options.maxSplats}`);
  console.log(`generated splat count: ${splats.length}`);
  console.log(`ply format: ${options.format}`);
  console.log(`output path: ${path.resolve(options.outputPath)}`);
}

function parseArgs(argv) {
  const [inputPath, outputPath, ...rest] = argv;

  if (!inputPath || !outputPath) {
    throw new Error([
      'Usage:',
      '  node src/meshToSplat.js input.glb output.ply --maxSplats 50000 --opacity 2.0 --radiusFactor 1.0 --format binary'
    ].join('\n'));
  }

  const options = {
    inputPath,
    outputPath,
    maxSplats: 50000,
    opacity: 2.0,
    radiusFactor: 1.0,
    format: 'binary'
  };

  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    const value = rest[i + 1];

    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }

    if (key === '--maxSplats') {
      options.maxSplats = Number.parseInt(value, 10);
    } else if (key === '--opacity') {
      options.opacity = Number.parseFloat(value);
    } else if (key === '--radiusFactor') {
      options.radiusFactor = Number.parseFloat(value);
    } else if (key === '--format') {
      options.format = value.toLowerCase();
    } else {
      throw new Error(`Unknown option: ${key}`);
    }

    i += 1;
  }

  return options;
}

function validateOptions(options) {
  const inputExt = path.extname(options.inputPath).toLowerCase();
  const outputExt = path.extname(options.outputPath).toLowerCase();

  if (!['.glb', '.gltf'].includes(inputExt)) {
    throw new Error(`Input must be a .glb or .gltf file. Received: ${options.inputPath}`);
  }

  if (outputExt !== '.ply') {
    throw new Error(`Output must be a .ply file. Received: ${options.outputPath}`);
  }

  if (!Number.isInteger(options.maxSplats) || options.maxSplats <= 0) {
    throw new Error('--maxSplats must be a positive integer.');
  }

  if (!Number.isFinite(options.opacity)) {
    throw new Error('--opacity must be a finite number.');
  }

  if (!Number.isFinite(options.radiusFactor) || options.radiusFactor <= 0) {
    throw new Error('--radiusFactor must be a positive number.');
  }

  if (!['binary', 'ascii'].includes(options.format)) {
    throw new Error('--format must be either "binary" or "ascii".');
  }
}

function collectTriangles(meshes, textureCache) {
  const triangles = [];
  let primitiveCount = 0;

  for (const mesh of meshes) {
    for (const primitive of mesh.listPrimitives()) {
      primitiveCount += 1;

      const positionAccessor = primitive.getAttribute('POSITION');
      if (!positionAccessor) {
        const meshName = mesh.getName() || '(unnamed mesh)';
        throw new Error(`Primitive ${primitiveCount} in ${meshName} does not have a POSITION attribute.`);
      }

      const normalAccessor = primitive.getAttribute('NORMAL');
      const colorAccessor = primitive.getAttribute('COLOR_0');
      const colorSource = getPrimitiveColorSource(primitive, textureCache);
      const indices = getPrimitiveIndices(primitive, positionAccessor.getCount());
      const triangleIndices = buildTriangleIndices(indices, primitive.getMode());

      for (const [i0, i1, i2] of triangleIndices) {
        const a = readVec3(positionAccessor, i0);
        const b = readVec3(positionAccessor, i1);
        const c = readVec3(positionAccessor, i2);
        const area = triangleArea(a, b, c);

        if (area <= 0) continue;

        const faceNormal = triangleNormal(a, b, c);

        triangles.push({
          a,
          b,
          c,
          area,
          faceNormal,
          normals: normalAccessor
            ? [readVec3(normalAccessor, i0), readVec3(normalAccessor, i1), readVec3(normalAccessor, i2)]
            : null,
          colors: colorAccessor
            ? [
                readColor(colorAccessor, i0),
                readColor(colorAccessor, i1),
                readColor(colorAccessor, i2)
              ]
            : null,
          texcoords: colorSource.texcoordAccessor
            ? [
                readVec2(colorSource.texcoordAccessor, i0),
                readVec2(colorSource.texcoordAccessor, i1),
                readVec2(colorSource.texcoordAccessor, i2)
              ]
            : null,
          texture: colorSource.texture,
          wrapS: colorSource.wrapS,
          wrapT: colorSource.wrapT,
          materialColor: colorSource.materialColor
        });
      }
    }
  }

  triangles.primitiveCount = primitiveCount;
  return triangles;
}

function buildSplats(triangles, totalArea, options) {
  const splats = [];
  const counts = allocateSplatCounts(triangles, totalArea, options.maxSplats);

  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    const triangle = triangles[triangleIndex];
    const triangleSplats = counts[triangleIndex];
    if (triangleSplats <= 0) continue;

    const splatArea = triangle.area / triangleSplats;
    const radius = Math.max(
      MIN_RADIUS,
      Math.sqrt(splatArea / Math.PI) * options.radiusFactor
    );
    const logRadius = Math.log(radius);
    const logThinRadius = Math.log(Math.max(MIN_RADIUS, radius * 0.05));

    for (let i = 0; i < triangleSplats; i += 1) {
      const weights = sampleTriangleBarycentric();
      const position = weightedVec3(triangle.a, triangle.b, triangle.c, weights);
      const normal = triangle.normals
        ? normalize(weightedVec3(triangle.normals[0], triangle.normals[1], triangle.normals[2], weights), triangle.faceNormal)
        : triangle.faceNormal;
      const rgb = triangle.colors
        ? weightedVec3(triangle.colors[0], triangle.colors[1], triangle.colors[2], weights).map(clamp01)
        : triangle.texture && triangle.texcoords
          ? sampleTexturedColor(triangle, weights)
        : triangle.materialColor;
      const sh = rgbToShDc(rgb);
      const rotation = quaternionFromZToNormal(normal);

      splats.push({
        x: position[0],
        y: position[1],
        z: position[2],
        f_dc_0: sh[0],
        f_dc_1: sh[1],
        f_dc_2: sh[2],
        opacity: options.opacity,
        scale_0: logRadius,
        scale_1: logRadius,
        scale_2: logThinRadius,
        rot_0: rotation[0],
        rot_1: rotation[1],
        rot_2: rotation[2],
        rot_3: rotation[3]
      });
    }
  }

  return splats;
}

function sampleTexturedColor(triangle, weights) {
  const uv = weightedVec2(triangle.texcoords[0], triangle.texcoords[1], triangle.texcoords[2], weights);
  const textureRgb = sampleTextureRgb(triangle.texture, uv, triangle.wrapS, triangle.wrapT);

  if (!textureRgb) return triangle.materialColor;

  return [
    clamp01(textureRgb[0] * triangle.materialColor[0]),
    clamp01(textureRgb[1] * triangle.materialColor[1]),
    clamp01(textureRgb[2] * triangle.materialColor[2])
  ];
}

function weightedVec2(a, b, c, weights) {
  return [
    a[0] * weights[0] + b[0] * weights[1] + c[0] * weights[2],
    a[1] * weights[0] + b[1] * weights[1] + c[1] * weights[2]
  ];
}

function allocateSplatCounts(triangles, totalArea, maxSplats) {
  const allocations = triangles.map((triangle, index) => {
    const exact = maxSplats * triangle.area / totalArea;
    const count = Math.floor(exact);

    return {
      index,
      count,
      remainder: exact - count
    };
  });

  let assigned = allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  const byRemainderDesc = [...allocations].sort((a, b) => b.remainder - a.remainder);

  for (const allocation of byRemainderDesc) {
    if (assigned >= maxSplats) break;
    allocation.count += 1;
    assigned += 1;
  }

  if (assigned > maxSplats) {
    const byRemainderAsc = [...allocations].sort((a, b) => a.remainder - b.remainder);
    for (const allocation of byRemainderAsc) {
      if (assigned <= maxSplats) break;
      if (allocation.count <= 0) continue;
      allocation.count -= 1;
      assigned -= 1;
    }
  }

  const counts = new Array(triangles.length).fill(0);
  for (const allocation of allocations) {
    counts[allocation.index] = allocation.count;
  }

  return counts;
}

function getPrimitiveIndices(primitive, vertexCount) {
  const indices = primitive.getIndices();
  if (indices) return Array.from(indices.getArray());

  return Array.from({ length: vertexCount }, (_, i) => i);
}

function buildTriangleIndices(indices, mode = GLTF_MODE.TRIANGLES) {
  if (mode === GLTF_MODE.TRIANGLES) {
    const triangles = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
      triangles.push([indices[i], indices[i + 1], indices[i + 2]]);
    }
    return triangles;
  }

  if (mode === GLTF_MODE.TRIANGLE_STRIP) {
    const triangles = [];
    for (let i = 0; i + 2 < indices.length; i += 1) {
      triangles.push(
        i % 2 === 0
          ? [indices[i], indices[i + 1], indices[i + 2]]
          : [indices[i + 1], indices[i], indices[i + 2]]
      );
    }
    return triangles;
  }

  if (mode === GLTF_MODE.TRIANGLE_FAN) {
    const triangles = [];
    for (let i = 1; i + 1 < indices.length; i += 1) {
      triangles.push([indices[0], indices[i], indices[i + 1]]);
    }
    return triangles;
  }

  console.warn(`Skipping primitive with unsupported glTF mode: ${mode}`);
  return [];
}

function getMaterialColor(primitive) {
  const material = primitive.getMaterial();
  if (!material) return DEFAULT_COLOR;

  const factor = material.getBaseColorFactor?.();
  if (!factor) return DEFAULT_COLOR;

  return [
    clamp01(factor[0]),
    clamp01(factor[1]),
    clamp01(factor[2])
  ];
}

function getPrimitiveColorSource(primitive, textureCache) {
  const material = primitive.getMaterial();
  const materialColor = getMaterialColor(primitive);
  const baseColorTexture = material?.getBaseColorTexture?.() ?? null;
  const baseColorTextureInfo = material?.getBaseColorTextureInfo?.() ?? null;
  const texCoordIndex = baseColorTextureInfo?.getTexCoord?.() ?? 0;
  const texcoordAccessor = baseColorTexture
    ? primitive.getAttribute(`TEXCOORD_${texCoordIndex}`)
    : null;
  const texture = texcoordAccessor
    ? getDecodedTexture(baseColorTexture, textureCache)
    : null;

  return {
    materialColor,
    texcoordAccessor: texture ? texcoordAccessor : null,
    texture,
    wrapS: baseColorTextureInfo?.getWrapS?.(),
    wrapT: baseColorTextureInfo?.getWrapT?.()
  };
}

function readVec3(accessor, index) {
  const value = [0, 0, 0];
  accessor.getElement(index, value);
  return [value[0], value[1], value[2]];
}

function readVec2(accessor, index) {
  const value = [0, 0];
  accessor.getElement(index, value);
  return [value[0], value[1]];
}

function readColor(accessor, index) {
  const value = [1, 1, 1, 1];
  accessor.getElement(index, value);

  const rgb = [value[0], value[1], value[2]];

  if (rgb.some((channel) => channel > 1)) {
    return normalizeIntegerColor(accessor, rgb);
  }

  return rgb.map(clamp01);
}

function normalizeIntegerColor(accessor, rgb) {
  const componentType = accessor.getComponentType?.();
  const divisorByComponentType = {
    5121: 255,
    5123: 65535
  };
  const divisor = divisorByComponentType[componentType] || Math.max(...rgb, 1);

  return rgb.map((channel) => clamp01(channel / divisor));
}

main().catch((error) => {
  console.error(`mesh-to-splat failed: ${error.message}`);
  process.exitCode = 1;
});
