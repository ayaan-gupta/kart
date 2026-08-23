import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BagTray } from '../../components/BagTray';
import { Button } from '../../components/Button';
import { CaptureGuide, guideVisible } from '../../components/CaptureGuide';
import { CoachNotice, coachKind } from '../../components/CoachNotice';
import { GlassSurface } from '../../components/GlassSurface';
import { IconButton } from '../../components/IconButton';
import { ItemHighlights } from '../../components/ItemHighlights';
import { color, radius, space } from '../../design/tokens';
import { Caption, Headline, Sub } from '../../design/type';
import { createCoverageState, type CoverageState } from '../../engine/liveVision/coverage';
import { devRequestCensus, devRequestIdentify } from '../../engine/liveVision/devFixtures';
import { requestCensus, requestIdentify } from '../../engine/liveVision/recognitionClient';
import { buildScanCartArgs, isScanCartPluginAvailable, toFrameScan } from '../../engine/liveVision/frameProcessor';
import {
  isFrameLabNativeAvailable,
  probeWorkletBoundary,
  scanBundledTestImage,
  type WorkletBoundaryProbeResult,
} from '../../engine/liveVision/frameLabNative';
import { CAPTURED_FRAME_LAB_INSTANCES } from '../../engine/liveVision/__fixtures__/capturedFrameLabInstances';
import { bagLines } from '../../engine/liveVision/fusion';
import { persistentAmber, RecognitionSession, tracksNeedingThumbnail } from '../../engine/liveVision/orchestrator';
import { createPipelineState, processFrame } from '../../engine/liveVision/pipeline';
import { saveThumbnail } from '../../engine/thumbnails';
import { useScanline } from '../../engine/store';
import type { FrameScan, Identity, ScanRequest, Track } from '../../engine/liveVision/types';

/**
 * Developer-only harness: pushes the bundled `assets/dev/cart-lab-sample.png` test photograph
 * through the real native plugin (via the debug-only `KartFrameLab` native module) and then the
 * real JS pipeline, rendering the same overlay and bag components the live scan screen uses.
 *
 * Not reachable from any normal-user navigation: no screen in `src/app` links here, and the one
 * entry point (a long-press on the home screen's logo, see `src/app/index.tsx`) is gated behind
 * `__DEV__`. The native half is Debug-build-only too (see `ios/Kart/KartFrameLab.swift`), so on
 * a Release build the screen still exists as a route but has nothing to call and says so.
 *
 * Two modes, both driving the exact same native call every iteration:
 *
 *  - "Run live": the whole native reply, instances included, comes straight from this run's own
 *    call into the real plugin. On the Simulator this reliably surfaces a real finding, not a
 *    harness bug: `VNGenerateForegroundInstanceMaskRequest` (`AppleInstanceMaskDetector`) fails
 *    on every call with Vision error code 9, "Could not create inference context" - the
 *    Simulator cannot run this request at all, confirmed by the same unmodified detector code
 *    succeeding when run outside the Simulator sandbox against this same image (`npm run
 *    bench:detector`). See the report for the full account.
 *  - "Replay captured Vision output": still calls the real plugin every iteration (so sharpness,
 *    motion, native error, keyframe encoding and crop generation are all still live and real -
 *    none of those depend on Vision's inference context), but replaces the (always-empty, on
 *    Simulator) `instances` array with `CAPTURED_FRAME_LAB_INSTANCES`, genuine
 *    `AppleInstanceMaskDetector` output for this exact image, captured outside the Simulator.
 *    This is what lets ByteTrack, the counting rule, the overlay and the bag be shown running
 *    for real against real detector geometry despite the one piece the Simulator cannot supply.
 *
 * What this proves, and what it deliberately does not: see
 * .superpowers/sdd/2026-08-14-kart-fusion-and-ui/simulator-e2e-report.md.
 */

const TEST_IMAGE = require('../../../assets/dev/cart-lab-sample.png');
const RUN_ITERATIONS = 6;
const ITERATION_DELAY_MS = 300;

type RunStatus = 'idle' | 'loading-asset' | 'running' | 'done' | 'error';
/**
 * `offline` fails every census, so the unavailable notice can be seen without a broken server.
 *
 * `server` is the one mode that leaves this device. It calls the real `requestCensus` and
 * `requestIdentify` against `EXPO_PUBLIC_KART_API_URL`, which is the change devFixtures.ts
 * anticipated ("swapping in the real recognitionClient.ts functions, once a server exists, is a
 * one-line change in the dev screen"). It is a separate mode rather than a replacement because
 * the other three must keep working with no endpoint configured and no key.
 *
 * What it is for: every other mode exercises the pipeline down to a local stand-in, so none of
 * them can tell you whether the app can actually reach a recognition service. That question is
 * the difference between a build that names things on a phone and one that does not, and until
 * this mode existed nothing in the app answered it.
 */
type RunMode = 'live' | 'replay' | 'offline' | 'server';

function StatusLine({ label, value, good }: { label: string; value: string; good: boolean | null }) {
  const dot = good === null ? color.sub : good ? color.teal : color.record;
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: dot }]} />
      <Caption color={color.onFeedSub} style={styles.statusLabel}>
        {label}
      </Caption>
      <Caption color={color.onFeed} style={styles.statusValue} numberOfLines={1}>
        {value}
      </Caption>
    </View>
  );
}

export default function FrameLabScreen() {
  const insets = useSafeAreaInsets();

  const pipelineStateRef = useRef(createPipelineState());
  const sessionRef = useRef<RecognitionSession | null>(null);
  if (sessionRef.current === null) {
    // Same lazy-once construction scan.tsx uses, and the same reason: built exactly once, on
    // first render, guarded by the null check.
    sessionRef.current = new RecognitionSession({
      // The one deliberately-not-real piece of this harness. See devFixtures.ts: no recognition
      // server is deployed, so these are local, offline, deterministic stand-ins that match the
      // real requestCensus/requestIdentify shape exactly. Everything else below is real.
      requestCensus: devRequestCensus,
      requestIdentify: devRequestIdentify,
      // No network for barcodes either: the test image carries none, so this fast path naturally
      // never fires rather than being mocked out.
      lookupBarcode: async () => null,
      saveThumbnail,
    });
  }

  const [status, setStatus] = useState<RunStatus>('idle');
  const [mode, setMode] = useState<RunMode>('live');
  const [iteration, setIteration] = useState(0);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [identities, setIdentities] = useState<Record<string, Identity>>({});
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [lastScan, setLastScan] = useState<FrameScan | null>(null);
  const [amberPersists, setAmberPersists] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [probe, setProbe] = useState<WorkletBoundaryProbeResult | null>(null);
  const [probing, setProbing] = useState(false);

  const runTokenRef = useRef(0);
  const [coverage] = useState<CoverageState>(createCoverageState());

  const pluginAvailable = isScanCartPluginAvailable();
  const nativeAvailable = isFrameLabNativeAvailable();

  useEffect(() => {
    useScanline.getState().startScan();
    // Never leaves a dev run sitting in the real scan session: back out of this screen and the
    // in-progress (never finished, never saved) scan is discarded, exactly like closing the
    // real scan screen without tapping Finish. Nothing here ever calls `finishHaul`, so a dev
    // run can never write a haul into persisted storage.
    return () => useScanline.getState().discardScan();
  }, []);

  const run = useCallback(async (runMode: RunMode) => {
    const token = ++runTokenRef.current;
    setStatus('loading-asset');
    setMode(runMode);
    setErrorText(null);
    setUnavailable(false);
    pipelineStateRef.current = createPipelineState();
    sessionRef.current = new RecognitionSession({
      // In `offline` mode the census answers the way a server that is down, unreachable or out of
      // credit does. Nothing else changes, so what appears on screen is the real notice driven by
      // the real session state, not a rendering of a hard-coded kind.
      requestCensus: runMode === 'offline'
        ? (async () => ({ ok: false, failure: 'server' })) as typeof devRequestCensus
        : runMode === 'server'
          ? requestCensus
          : devRequestCensus,
      requestIdentify: runMode === 'server' ? requestIdentify : devRequestIdentify,
      lookupBarcode: async () => null,
      saveThumbnail,
    });
    setTracks([]);
    setIdentities({});
    setIteration(0);
    useScanline.getState().setBag([], {});

    try {
      const asset = Asset.fromModule(TEST_IMAGE);
      await asset.downloadAsync();
      const path = asset.localUri ?? asset.uri;
      if (!path) throw new Error('bundled test image has no local URI');

      setStatus('running');
      let nextRequest: ScanRequest = { wantKeyframe: false, cropTrackIds: [] };

      for (let i = 1; i <= RUN_ITERATIONS; i++) {
        if (runTokenRef.current !== token) return; // superseded by a newer run

        const session = sessionRef.current;
        if (session === null) return;

        const args = buildScanCartArgs(nextRequest);
        const raw = await scanBundledTestImage(path, args);
        // Always the real native reply. In "replay" mode only `instances` (the one piece the
        // Simulator cannot produce; see the module doc above) is swapped for real, previously
        // captured detector output. sharpness, motion, error, keyframe and crops all stay
        // exactly what this call's own live plugin invocation returned, in both modes.
        // `offline` needs instances too: without tracks nothing is ever confirmed, no keyframe
        // fires, and no census is attempted, so the failure it exists to show could never happen.
        const scan: FrameScan =
          runMode === 'replay' || runMode === 'offline' || runMode === 'server'
            ? { ...toFrameScan(raw), instances: CAPTURED_FRAME_LAB_INSTANCES }
            : toFrameScan(raw);
        setLastScan(scan);

        const now = Date.now();
        const result = processFrame(pipelineStateRef.current, scan, now);
        pipelineStateRef.current = result.state;
        setTracks(result.tracks);
        if (scan.width > 0 && scan.height > 0) setFrameSize({ width: scan.width, height: scan.height });
        setIteration(i);

        const refreshNextRequest = () => {
          nextRequest = {
            wantKeyframe: session.wantsKeyframe(result.tracks, result.keyframe.fire),
            cropTrackIds: tracksNeedingThumbnail(session.state, result.tracks),
          };
        };
        refreshNextRequest();

        const publish = () => {
          setIdentities({ ...session.state.fusion.identities });
          useScanline.getState().setBag(bagLines(session.state.fusion), session.state.thumbnails);
          refreshNextRequest();
        };

        if (scan.keyframe !== null) {
          // `onCapture`, not `onKeyframe`, because `scan.tsx` uses `onCapture` and this harness is
          // only worth anything if it exercises the path that ships. It sends the frame with no
          // marks so the service enumerates it, and hands back a tracker built from the regions
          // the service found; `scan.tsx` writes that back the same way.
          //
          // This screen used `onKeyframe` for its whole life, which meant every end-to-end claim
          // made through it was a claim about the older marks-from-the-device path.
          // `scan.capturePath.test.ts` exists because `onCapture` was once "called from nothing
          // but its own tests for a week", and this was the same drift from the other side.
          const captured = await session.onCapture(
            scan.keyframe, pipelineStateRef.current.tracker, now);
          if (captured !== null) {
            pipelineStateRef.current = {
              ...pipelineStateRef.current,
              tracker: captured.tracker,
            };
            setTracks(captured.tracks);
          }
          publish();
        }
        if (scan.crops.length > 0) {
          await session.onCrops(scan.crops);
          publish();
        }
        const hits = result.tracks
          .filter((t) => t.barcode !== null)
          .map((t) => ({ trackId: t.id, payload: t.barcode as string }));
        if (hits.length > 0) {
          await session.onBarcodes(hits);
          publish();
        }

        setAmberPersists(persistentAmber(session.state, result.tracks, Date.now()));
        setUnavailable(session.state.censusFailures > 0
          && session.state.censusFailures === session.state.censusCalls);

        if (i < RUN_ITERATIONS) await new Promise((resolve) => setTimeout(resolve, ITERATION_DELAY_MS));
      }

      if (runTokenRef.current === token) setStatus('done');
    } catch (error) {
      if (runTokenRef.current !== token) return;
      setErrorText(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // `run` sets state, and calling it directly here would run its synchronous-until-the-first-
    // `await` prologue inside this effect's own call frame - the same cascading-render shape
    // `scan.tsx`'s permission-request effect avoids by only ever calling setState from inside a
    // promise callback, never directly in the effect body. Routing the call through `.then`
    // matches that precedent exactly, deferring it a microtask.
    void Promise.resolve().then(() => run('live'));
    // Deliberately runs once on mount only. `run` closes over refs and stable setState, so this
    // is safe to fire-and-forget the same way scan.tsx's effects are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await probeWorkletBoundary();
      setProbe(result);
    } catch (error) {
      setProbe({
        ranOnWorkletRuntime: false,
        regressedToUnsharedFunctionError: false,
        scanCartError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProbing(false);
    }
  }, []);

  const guide = guideVisible({ occluded: false, coverage });
  const close = () => router.back();

  return (
    <View style={styles.screen}>
      <Image source={TEST_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" />
      <ItemHighlights tracks={tracks} identities={identities} frameSize={frameSize} />

      <View style={[styles.topBar, { top: insets.top + space.s }]}>
        <IconButton symbol="xmark" fallback="✕" accessibilityLabel="Close Frame Lab" onPress={close} scheme="dark" />
        <GlassSurface radius={radius.pill} scheme="dark" floating={false}>
          <View style={styles.titleChip}>
            <Caption color={color.onFeed}>Frame Lab · dev only</Caption>
          </View>
        </GlassSurface>
      </View>

      <CaptureGuide coverage={coverage} visible={guide} />

      <ScrollView
        style={[styles.diagnostics, { top: insets.top + 56 }]}
        contentContainerStyle={styles.diagnosticsContent}
      >
        <GlassSurface radius={radius.card} scheme="dark" floating={false}>
          <View style={styles.panel}>
            <Headline color={color.onFeed}>Diagnostics</Headline>
            <StatusLine label="scanCart plugin" value={pluginAvailable ? 'resolved' : 'unavailable'} good={pluginAvailable} />
            <StatusLine
              label="KartFrameLab native"
              value={nativeAvailable ? 'linked' : 'unavailable (Release build?)'}
              good={nativeAvailable}
            />
            <StatusLine
              label="run"
              value={
                status === 'running' || status === 'loading-asset'
                  ? `iteration ${iteration}/${RUN_ITERATIONS} (${mode})`
                  : `${status} (${mode})`
              }
              good={status === 'done' ? true : status === 'error' ? false : null}
            />
            {lastScan ? (
              <>
                <StatusLine label="instances" value={String(lastScan.instances.length)} good={null} />
                <StatusLine label="barcodes" value={String(lastScan.barcodes.length)} good={null} />
                <StatusLine
                  label="sharpness / motion"
                  value={`${lastScan.sharpness.toFixed(1)} / ${lastScan.motion.toFixed(3)}`}
                  good={null}
                />
                <StatusLine label="native error" value={lastScan.error ?? 'none'} good={lastScan.error === null} />
                <StatusLine label="keyframe encoded" value={lastScan.keyframe !== null ? 'yes' : 'no'} good={null} />
                <StatusLine label="crops encoded" value={String(lastScan.crops.length)} good={null} />
              </>
            ) : null}
            {errorText ? (
              <Sub color={color.record} style={styles.errorText}>
                {errorText}
              </Sub>
            ) : null}

            <Sub color={color.onFeedSub} style={styles.probeCopy}>
              &quot;Run live&quot; uses only what the plugin returns this run. &quot;Replay&quot;
              still calls the same live plugin every iteration, but swaps in real captured
              AppleInstanceMaskDetector output for the one thing the Simulator cannot produce.
              See the diagnostics above: sharpness, motion, keyframe and crops stay live either
              way.
            </Sub>
            <View style={styles.buttonRow}>
              <Button label="Run live" onPress={() => void run('live')} />
            </View>
            <View style={styles.buttonRow}>
              <Button label="Replay captured Vision output" onPress={() => void run('replay')} />
            </View>
            <View style={styles.buttonRow}>
              {/* Every census fails, which is what a shopper gets when the service is down or the
                  account is out of credit. Before the eighty-fifth section of KART.md that was a
                  silent empty bag; this is how the notice that replaced it gets looked at without
                  a camera or a broken server. */}
              <Button label="Run with recognition offline" onPress={() => void run('offline')} />
            </View>
            <View style={styles.buttonRow}>
              {/* The only mode that leaves the device. Everything else here answers "does the
                  pipeline work"; this one answers "can this build reach a recognition service",
                  which is the question that decides whether a phone names anything. It needs
                  EXPO_PUBLIC_KART_API_URL set at build time and a server on the other end; see
                  docs/running-on-a-phone.md. */}
              <Button label="Run against the recognition server" onPress={() => void run('server')} />
            </View>

            <View style={styles.divider} />
            <Headline color={color.onFeed}>Worklet boundary probe</Headline>
            <Sub color={color.onFeedSub} style={styles.probeCopy}>
              Calls the real scanCart from a genuine second worklet runtime. A camera-shaped
              error below, not a cannot-be-shared error, means the worklet and plugin-object
              crossing are healthy; only a real Frame from a camera is missing.
            </Sub>
            {probe ? (
              <>
                <StatusLine
                  label="ran on worklet runtime"
                  value={probe.ranOnWorkletRuntime ? 'yes' : 'no'}
                  good={probe.ranOnWorkletRuntime}
                />
                <StatusLine
                  label="regressed (cannot be shared)"
                  value={probe.regressedToUnsharedFunctionError ? 'YES - regression' : 'no'}
                  good={!probe.regressedToUnsharedFunctionError}
                />
                <Sub color={color.onFeedSub} style={styles.probeCopy}>
                  scanCart error: {probe.scanCartError ?? 'none'}
                </Sub>
              </>
            ) : null}
            <View style={styles.buttonRow}>
              <Button label={probing ? 'Probing…' : 'Probe worklet boundary'} onPress={() => void runProbe()} />
            </View>
          </View>
        </GlassSurface>
      </ScrollView>

      {/* After the diagnostics sheet, not before it: the sheet is pinned to the same top
          offset the notice uses, and in this harness the notice is the thing being looked at.
          scan.tsx has nothing above it, so the order there is unchanged. */}
      <CoachNotice kind={coachKind({ amberPersists, occluded: guide, unavailable })} topInset={insets.top} />

      <BagTray onFinish={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.feed },
  topBar: {
    position: 'absolute',
    left: space.l,
    right: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleChip: { paddingHorizontal: space.m, paddingVertical: 8 },
  diagnostics: {
    position: 'absolute',
    left: space.l,
    right: space.l,
    maxHeight: 560,
  },
  diagnosticsContent: { paddingBottom: space.s },
  panel: { padding: space.l, gap: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { flex: 1 },
  statusValue: { flexShrink: 1, textAlign: 'right', maxWidth: '55%' },
  errorText: { marginTop: 4 },
  buttonRow: { marginTop: space.s },
  divider: { height: 1, backgroundColor: color.feedRaise, marginVertical: space.m },
  probeCopy: { lineHeight: 18 },
});
