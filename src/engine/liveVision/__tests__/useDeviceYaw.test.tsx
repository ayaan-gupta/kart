import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { PermissionStatus, type PermissionResponse } from 'expo-modules-core';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { useDeviceYaw } from '../useDeviceYaw';

jest.mock('expo-sensors', () => ({
  DeviceMotion: {
    isAvailableAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn(),
  },
}));

const isAvailableAsync = jest.mocked(DeviceMotion.isAvailableAsync);
const requestPermissionsAsync = jest.mocked(DeviceMotion.requestPermissionsAsync);
const setUpdateInterval = jest.mocked(DeviceMotion.setUpdateInterval);
const addListener = jest.mocked(DeviceMotion.addListener);

const GRANTED: PermissionResponse = {
  status: PermissionStatus.GRANTED,
  expires: 'never',
  granted: true,
  canAskAgain: true,
};
const DENIED: PermissionResponse = {
  status: PermissionStatus.DENIED,
  expires: 'never',
  granted: false,
  canAskAgain: true,
};

function motionEvent(alpha: number): DeviceMotionMeasurement {
  return {
    acceleration: null,
    accelerationIncludingGravity: { x: 0, y: 0, z: 0, timestamp: 0 },
    interval: 100,
    orientation: 0,
    rotation: { alpha, beta: 0, gamma: 0, timestamp: 0 },
    rotationRate: null,
  };
}

/**
 * Renders the hook through a tiny host component and reports every value it returns, the same
 * way `@testing-library/react-hooks`'s `renderHook` would, without adding a new test dependency
 * to a codebase that already standardizes on `react-test-renderer`.
 */
function HookHost({ active, onValue }: { active: boolean; onValue: (v: number | null) => void }) {
  const yaw = useDeviceYaw(active);
  onValue(yaw);
  return null;
}

describe('useDeviceYaw', () => {
  let removeSpy: jest.Mock;
  let capturedListener: ((data: DeviceMotionMeasurement) => void) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedListener = null;
    removeSpy = jest.fn();
    addListener.mockImplementation((listener) => {
      capturedListener = listener;
      return { remove: removeSpy };
    });
  });

  // A hook that ignored `active` and always polled the sensor would fail this: the sensor calls
  // never happen and the value never leaves null.
  it('stays null and never touches the sensor while inactive', async () => {
    let latest: number | null = 999;
    await act(async () => {
      TestRenderer.create(<HookHost active={false} onValue={(v) => { latest = v; }} />);
    });
    expect(latest).toBeNull();
    expect(isAvailableAsync).not.toHaveBeenCalled();
  });

  it('stays null when the sensor reports unavailable, without asking for permission', async () => {
    isAvailableAsync.mockResolvedValue(false);
    let latest: number | null = 999;
    await act(async () => {
      TestRenderer.create(<HookHost active onValue={(v) => { latest = v; }} />);
    });
    expect(latest).toBeNull();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('stays null when permission is denied, without subscribing', async () => {
    isAvailableAsync.mockResolvedValue(true);
    requestPermissionsAsync.mockResolvedValue(DENIED);
    let latest: number | null = 999;
    await act(async () => {
      TestRenderer.create(<HookHost active onValue={(v) => { latest = v; }} />);
    });
    expect(latest).toBeNull();
    expect(addListener).not.toHaveBeenCalled();
  });

  // The core check: a hook that subscribed but ignored the measurement (or read the wrong
  // field) would leave `latest` at its initial value forever. This is the one test in this
  // suite that would fail for a guide that "ignored the yaw entirely".
  it('reports the sensor-provided yaw once available and permitted', async () => {
    isAvailableAsync.mockResolvedValue(true);
    requestPermissionsAsync.mockResolvedValue(GRANTED);
    let latest: number | null = null;
    await act(async () => {
      TestRenderer.create(<HookHost active onValue={(v) => { latest = v; }} />);
    });

    expect(setUpdateInterval).toHaveBeenCalledWith(100);
    expect(capturedListener).not.toBeNull();
    expect(latest).toBeNull(); // no measurement delivered yet

    act(() => {
      capturedListener!(motionEvent(1.23));
    });
    expect(latest).toBe(1.23);

    // A second, different measurement must actually move the value, not just flip a boolean.
    act(() => {
      capturedListener!(motionEvent(-2.5));
    });
    expect(latest).toBe(-2.5);
  });

  it('ignores a NaN alpha rather than surfacing garbage', async () => {
    isAvailableAsync.mockResolvedValue(true);
    requestPermissionsAsync.mockResolvedValue(GRANTED);
    let latest: number | null = null;
    await act(async () => {
      TestRenderer.create(<HookHost active onValue={(v) => { latest = v; }} />);
    });

    act(() => {
      capturedListener!(motionEvent(NaN));
    });
    expect(latest).toBeNull();
  });

  it('removes the subscription once it goes inactive again', async () => {
    isAvailableAsync.mockResolvedValue(true);
    requestPermissionsAsync.mockResolvedValue(GRANTED);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<HookHost active onValue={() => {}} />);
    });
    expect(removeSpy).not.toHaveBeenCalled();

    await act(async () => {
      renderer.update(<HookHost active={false} onValue={() => {}} />);
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
