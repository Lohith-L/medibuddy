/**
 * location.ts
 *
 * One way to get the user's position on both platforms.
 *
 * - Android / iOS: uses @capacitor/geolocation, which shows the system
 *   permission popup. The Android WebView never shows a popup for
 *   navigator.geolocation, so it always failed with "permission denied".
 * - Website: keeps using navigator.geolocation, exactly as before.
 *
 * Failures reject with a LocationError whose `reason` says what went wrong.
 * On native, `userMessage` holds a friendly sentence to show the user.
 */
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export type LocationReason =
  | 'permission-denied'
  | 'location-off'
  | 'timeout'
  | 'unavailable'
  | 'unsupported';

export const LOCATION_MESSAGES: Record<LocationReason, string> = {
  'permission-denied':
    'Location is off for MediBuddy. Enable it in Settings > Apps > MediBuddy > Permissions.',
  'location-off':
    "Your phone's location is turned off. Please turn on Location in your quick settings and try again.",
  timeout: "We couldn't find your location in time. Please try again.",
  unavailable: "We couldn't get your location right now. Please try again.",
  unsupported: 'Location is not supported on this device.',
};

export class LocationError extends Error {
  readonly reason: LocationReason;
  /** Friendly text to show the user. Only set on native; the website stays silent as before. */
  readonly userMessage: string | null;

  constructor(reason: LocationReason, cause?: unknown) {
    super(LOCATION_MESSAGES[reason]);
    this.name = 'LocationError';
    this.reason = reason;
    this.userMessage = Capacitor.isNativePlatform() ? LOCATION_MESSAGES[reason] : null;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface Coords {
  lat: number;
  lng: number;
}

export interface LocationOptions {
  enableHighAccuracy?: boolean;
  /** Milliseconds. */
  timeout?: number;
}

/** Maps @capacitor/geolocation error codes (OS-PLUG-GLOC-xxxx) to a reason. */
function reasonFromNativeError(err: unknown): LocationReason {
  const code = (err as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'OS-PLUG-GLOC-0003': // permission denied
    case 'OS-PLUG-GLOC-0008': // restricted (iOS)
      return 'permission-denied';
    case 'OS-PLUG-GLOC-0007': // location services disabled
    case 'OS-PLUG-GLOC-0009': // user declined the "turn on location" dialog
    case 'OS-PLUG-GLOC-0017': // network and location both off
      return 'location-off';
    case 'OS-PLUG-GLOC-0010':
      return 'timeout';
    default:
      return 'unavailable';
  }
}

async function getNativeLocation(options: Required<LocationOptions>): Promise<Coords> {
  try {
    let status = await Geolocation.checkPermissions();
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      status = await Geolocation.requestPermissions();
    }
    // Android stops showing the popup after the user declines it twice, and
    // then reports 'denied' straight away. Either way, Settings is the fix.
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      throw new LocationError('permission-denied');
    }

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: options.enableHighAccuracy,
      timeout: options.timeout,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (err) {
    if (err instanceof LocationError) throw err;
    console.warn('[Location] native error:', err);
    throw new LocationError(reasonFromNativeError(err), err);
  }
}

function getWebLocation(options: Required<LocationOptions>): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const reason: LocationReason =
          err.code === err.PERMISSION_DENIED
            ? 'permission-denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        reject(new LocationError(reason, err));
      },
      { enableHighAccuracy: options.enableHighAccuracy, timeout: options.timeout },
    );
  });
}

/** Native always uses these, so every screen gets the same reliable fix. */
const NATIVE_OPTIONS: Required<LocationOptions> = { enableHighAccuracy: true, timeout: 15000 };

/**
 * Returns the user's current coordinates, asking for permission if needed.
 * `webOptions` only apply on the website, so each page keeps its old settings.
 * Rejects with a LocationError.
 */
export function getCurrentLocation(webOptions: LocationOptions = {}): Promise<Coords> {
  if (Capacitor.isNativePlatform()) return getNativeLocation(NATIVE_OPTIONS);
  return getWebLocation({
    enableHighAccuracy: webOptions.enableHighAccuracy ?? false,
    timeout: webOptions.timeout ?? 10000,
  });
}
