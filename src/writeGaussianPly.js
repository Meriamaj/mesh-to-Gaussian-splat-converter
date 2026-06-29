import { writeFile } from 'node:fs/promises';

const PLY_PROPERTIES = [
  'property float x',
  'property float y',
  'property float z',
  'property float nx',
  'property float ny',
  'property float nz',
  'property float f_dc_0',
  'property float f_dc_1',
  'property float f_dc_2',
  'property float opacity',
  'property float scale_0',
  'property float scale_1',
  'property float scale_2',
  'property float rot_0',
  'property float rot_1',
  'property float rot_2',
  'property float rot_3'
];

const PLY_FIELD_COUNT = 17;

export async function writeGaussianPly(outputPath, splats, options = {}) {
  const format = options.format ?? 'binary';

  if (format === 'ascii') {
    await writeAsciiGaussianPly(outputPath, splats);
    return;
  }

  if (format === 'binary') {
    await writeBinaryGaussianPly(outputPath, splats);
    return;
  }

  throw new Error(`Unsupported PLY output format: ${format}`);
}

async function writeAsciiGaussianPly(outputPath, splats) {
  const header = [
    'ply',
    'format ascii 1.0',
    `element vertex ${splats.length}`,
    ...PLY_PROPERTIES,
    'end_header'
  ];

  const rows = splats.map((splat) => [
    splat.x,
    splat.y,
    splat.z,
    0,
    0,
    0,
    splat.f_dc_0,
    splat.f_dc_1,
    splat.f_dc_2,
    splat.opacity,
    splat.scale_0,
    splat.scale_1,
    splat.scale_2,
    splat.rot_0,
    splat.rot_1,
    splat.rot_2,
    splat.rot_3
  ].map(formatFloat).join(' '));

  await writeFile(outputPath, `${header.concat(rows).join('\n')}\n`, 'utf8');
}

async function writeBinaryGaussianPly(outputPath, splats) {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${splats.length}`,
    ...PLY_PROPERTIES,
    'end_header'
  ].join('\n') + '\n';

  const headerBuffer = Buffer.from(header, 'utf8');
  const dataBuffer = Buffer.allocUnsafe(splats.length * PLY_FIELD_COUNT * 4);
  let offset = 0;

  for (const splat of splats) {
    offset = writeFloatRow(dataBuffer, offset, [
      splat.x,
      splat.y,
      splat.z,
      0,
      0,
      0,
      splat.f_dc_0,
      splat.f_dc_1,
      splat.f_dc_2,
      splat.opacity,
      splat.scale_0,
      splat.scale_1,
      splat.scale_2,
      splat.rot_0,
      splat.rot_1,
      splat.rot_2,
      splat.rot_3
    ]);
  }

  await writeFile(outputPath, Buffer.concat([headerBuffer, dataBuffer]));
}

function writeFloatRow(buffer, offset, values) {
  for (const value of values) {
    buffer.writeFloatLE(Number.isFinite(value) ? value : 0, offset);
    offset += 4;
  }

  return offset;
}

function formatFloat(value) {
  if (!Number.isFinite(value)) return '0';
  return Number(value).toPrecision(9);
}
