import { useDevice } from './use-device';

/**
 * Narrower than a tablet.
 * @deprecated Use `useDevice().narrow` (or `.phone`, which also counts a phone held sideways).
 */
export function useIsMobile() {
  return useDevice().narrow;
}

/**
 * How a phone lays a page out: `phone` for a phone either way up, `sideways` for one held on its side
 * (wide enough for the desktop width but short, so panels dock at the right instead of rising from the
 * bottom, as `LumenPhoneDrawer sideways` does).
 * @deprecated Use `useDevice()`, which has the same `phone` and `sideways`.
 */
export function usePhoneLayout() {
  const { phone, sideways } = useDevice();
  return { phone, sideways };
}
