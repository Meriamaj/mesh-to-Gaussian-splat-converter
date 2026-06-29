import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const WRAP_CLAMP_TO_EDGE = 33071;
const WRAP_MIRRORED_REPEAT = 33648;
const WRAP_REPEAT = 10497;

export function createTextureCache() {
  return new Map();
}

export function getDecodedTexture(texture, textureCache) {
  if (!texture) return null;
  if (textureCache.has(texture)) return textureCache.get(texture);

  const image = texture.getImage?.();
  const mimeType = texture.getMimeType?.();

  if (!image || !mimeType) {
    textureCache.set(texture, null);
    return null;
  }

  const bytes = Buffer.from(image);
  let decoded;

  if (mimeType === 'image/jpeg') {
    decoded = jpeg.decode(bytes, { useTArray: true });
  } else if (mimeType === 'image/png') {
    decoded = PNG.sync.read(bytes);
  } else {
    console.warn(`Skipping unsupported texture MIME type: ${mimeType}`);
    textureCache.set(texture, null);
    return null;
  }

  const result = {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data
  };

  textureCache.set(texture, result);
  return result;
}

export function sampleTextureRgb(texture, uv, wrapS = WRAP_REPEAT, wrapT = WRAP_REPEAT) {
  if (!texture) return null;

  const u = wrapUv(uv[0], wrapS);
  const v = wrapUv(uv[1], wrapT);
  const x = u * (texture.width - 1);
  const y = v * (texture.height - 1);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(texture.width - 1, x0 + 1);
  const y1 = Math.min(texture.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

  const c00 = readPixel(texture, x0, y0);
  const c10 = readPixel(texture, x1, y0);
  const c01 = readPixel(texture, x0, y1);
  const c11 = readPixel(texture, x1, y1);

  return [
    bilerp(c00[0], c10[0], c01[0], c11[0], tx, ty),
    bilerp(c00[1], c10[1], c01[1], c11[1], tx, ty),
    bilerp(c00[2], c10[2], c01[2], c11[2], tx, ty)
  ];
}

function wrapUv(value, mode) {
  if (mode === WRAP_CLAMP_TO_EDGE) {
    return Math.min(1, Math.max(0, value));
  }

  if (mode === WRAP_MIRRORED_REPEAT) {
    const wrapped = value - Math.floor(value);
    return Math.floor(value) % 2 === 0 ? wrapped : 1 - wrapped;
  }

  return value - Math.floor(value);
}

function readPixel(texture, x, y) {
  const offset = (y * texture.width + x) * 4;
  return [
    texture.data[offset] / 255,
    texture.data[offset + 1] / 255,
    texture.data[offset + 2] / 255
  ];
}

function bilerp(c00, c10, c01, c11, tx, ty) {
  const top = c00 * (1 - tx) + c10 * tx;
  const bottom = c01 * (1 - tx) + c11 * tx;
  return top * (1 - ty) + bottom * ty;
}
