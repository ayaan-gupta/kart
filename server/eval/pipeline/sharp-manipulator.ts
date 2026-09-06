/**
 * sharp standing in for the device's expo-image-manipulator, so a harness sends exactly what the
 * phone sends: `prepareUpload`'s bounded JPEG of the photograph, and `prepareCrops`' cuts of the
 * original at the boxes the census gave. Both go through the shipped rule (`uploadImage.ts`),
 * with only the pixel work done here.
 */
import sharp from 'sharp';
import { orientedSize } from '../../src/compositor.js';
import { cropRect, type Manipulator } from '../../../src/engine/liveVision/uploadImage';

export const sharpManipulator: Manipulator = {
  async toJpegBase64(uri, size, quality) {
    let image = sharp(uri).rotate();
    if (size !== null) image = image.resize({ ...size, withoutEnlargement: false });
    const buffer = await image.jpeg({ quality: Math.round(quality * 100) }).toBuffer();
    const meta = await sharp(buffer).metadata();
    return { base64: buffer.toString('base64'), width: meta.width ?? 0, height: meta.height ?? 0 };
  },

  async cropToJpegBase64(uri, box, padding, longEdge, quality) {
    const base = sharp(uri).rotate();
    const { width, height } = orientedSize(await base.metadata());
    const rect = cropRect(width, height, box, padding);
    if (rect === null) throw new Error('box has no area inside the photograph');
    let image = base.extract({ left: rect.originX, top: rect.originY, width: rect.width, height: rect.height });
    if (Math.max(rect.width, rect.height) > longEdge) {
      image = image.resize(rect.width >= rect.height ? { width: longEdge } : { height: longEdge });
    }
    const buffer = await image.jpeg({ quality: Math.round(quality * 100) }).toBuffer();
    const meta = await sharp(buffer).metadata();
    return { base64: buffer.toString('base64'), width: meta.width ?? 0, height: meta.height ?? 0 };
  },
};
