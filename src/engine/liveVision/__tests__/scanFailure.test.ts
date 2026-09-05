import { describeScanFailure } from '../scanFailure';

/**
 * The one line that turns "it just didn't work" into something a person can act on.
 *
 * `COACH_COPY.unavailable` says the bag is not being filled, and deliberately not why. That was
 * right for a shopper, and it left everyone else with nothing: a photograph on a phone produced
 * that notice, and nobody could say whether the phone reached the Mac, the Mac reached OpenAI, or
 * the photograph was refused. This line says which, and names the address that was tried.
 */
describe('describeScanFailure', () => {
  const at = 'http://Ayaans-MacBook-Pro.local:4310';

  it('names the address nothing answered at, and where to look on the phone', () => {
    const text = describeScanFailure('offline', at);
    expect(text).toContain(at);
    expect(text).toMatch(/Local Network/);
  });

  it('says a timeout is the service being slow, not absent', () => {
    const text = describeScanFailure('timeout', at);
    expect(text).toContain(at);
    expect(text).toMatch(/answer/i);
    expect(text).not.toMatch(/nothing answered/i);
  });

  it('points a server failure at the log on the Mac', () => {
    const text = describeScanFailure('server', at);
    expect(text).toContain(at);
    expect(text).toContain('server/.serve.log');
  });

  it('says a rejection is about the photograph, not the network', () => {
    expect(describeScanFailure('rejected', at)).toMatch(/refused|rejected/i);
  });

  it('says a malformed answer means something else is on that port', () => {
    expect(describeScanFailure('malformed', at)).toMatch(/something else|not the recognition service/i);
  });

  it('tells an unconfigured build what to run, and never prints a null address', () => {
    const text = describeScanFailure('unconfigured', null);
    expect(text).toContain('scripts/setup.sh');
    expect(text).not.toContain('null');
  });

  it('describes a photograph the device could not read, which never reached the network', () => {
    const text = describeScanFailure('capture', at);
    expect(text).toMatch(/photo/i);
    expect(text).not.toContain(at);
  });

  it('never prints a null address for any failure', () => {
    for (const failure of ['offline', 'timeout', 'server', 'rejected', 'malformed'] as const) {
      expect(describeScanFailure(failure, null)).not.toContain('null');
    }
  });
});
