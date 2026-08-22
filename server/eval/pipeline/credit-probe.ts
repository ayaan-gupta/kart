/**
 * One census call on a blank image, to answer "does the account have credit" without spending a
 * measurement run to find out. Prints and exits 0 either way; nothing here is a result.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/credit-probe.ts
 */
import sharp from 'sharp';
import { runCensus } from '../../src/recognize';

const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888888' } })
  .jpeg()
  .toBuffer();
try {
  const r = await runCensus(img, [{ id: 1, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }]);
  console.log(`CREDIT OK - the census answered with ${r.marks.length} mark(s).`);
} catch (e) {
  console.log(`STILL BLOCKED - ${String(e instanceof Error ? e.message : e).slice(0, 140)}`);
}
