import type { ClientFailure } from './recognitionClient';

/**
 * Everything a photograph can fail with: the six ways a request fails, plus the one that never
 * becomes a request because the device could not read the photograph.
 */
export type PhotoFailure = ClientFailure | 'capture';

/**
 * One plain line about why nothing went in the bag.
 *
 * `COACH_COPY.unavailable` says the bag is not being filled, and on purpose not why. That is
 * right for a shopper and it left everyone else with nothing: a photograph on a phone produced
 * that notice, and nobody could say whether the phone had reached the Mac, the Mac had reached
 * OpenAI, or the photograph had been refused. The client already knows which. This says it, and
 * names the address that was tried, which is the first thing anyone asks.
 *
 * Nothing here can carry a secret: the address is the one built into the app, and the failure
 * kinds are the client's own six words.
 */
export function describeScanFailure(failure: PhotoFailure, endpoint: string | null): string {
  const at = endpoint ?? 'the recognition service';
  switch (failure) {
    case 'unconfigured':
      return 'This build has no recognition address in it. Run ./scripts/setup.sh on the Mac and install the app again.';
    case 'offline':
      return `Nothing answered at ${at}. Is ./scripts/serve.sh running on that Mac, and is this phone on its wifi? On iPhone, Settings > Kart > Local Network must be on.`;
    case 'timeout':
      return `${at} took too long to answer. It is running, but the photo did not come back in time. Try once more.`;
    case 'rejected':
      return `${at} refused this photo. If every photo is refused, the app and the service are from different commits.`;
    case 'server':
      return `${at} could not recognise this photo. Its log says why: server/.serve.log on that Mac.`;
    case 'malformed':
      return `${at} answered, but not the way the recognition service does. Something else may be on that port.`;
    case 'capture':
      return 'This photo could not be read from the device, so nothing was sent.';
  }
}
