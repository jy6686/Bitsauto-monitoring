/**
 * Whether a URL that names a portal should bounce back to the main platform.
 *
 * This exists as a separate function because it was wrong in a way that was invisible inside
 * the component. The guard read:
 *
 *     if (activePortal && definitions.length > 0 && !!role) { ...redirect if not allowed }
 *
 * and the `!!role` term was there, by its own comment, to stop portal definitions arriving
 * before authentication from redirecting every cold deep link. It could never do that:
 * `useAuth` returns `user?.role ?? 'viewer'`, so `role` is a non-empty string from the first
 * render. The guard was always satisfied, the allowed list was computed as though the visitor
 * were a viewer, and a portal needing a higher role was refused before anyone knew who was
 * asking.
 *
 * Measured in production: on a redirecting load, portal definitions finished at 2062 ms and
 * the auth request at 2136 ms — definitions won by 74 ms, and both started within 14 ms of
 * each other. A hard load of /commercial bounced three times in four; a client-side
 * navigation never did, because by then auth had long since resolved.
 *
 * THE QUESTION IS "HAS AUTH RESOLVED", NOT "WHAT IS THE ROLE". Those are different, and the
 * `'viewer'` default is exactly what makes them look the same: it cannot be distinguished
 * from a real viewer. Asking the resolved question is what makes the race unobservable
 * instead of merely unlikely.
 */

export interface PortalRedirectInput {
  /** The portal slug in the URL, or null when the URL names no portal. */
  activePortal: string | null;
  /** Authentication has finished — we know who the user is, including "nobody". */
  authResolved: boolean;
  /** The portal definitions have arrived; before that the allowed list means nothing. */
  definitionsLoaded: boolean;
  /** Slugs this user may enter. Exact identities, never prefixes. */
  allowedSlugs: readonly string[];
}

/**
 * True only when we KNOW the user may not be here. Every "not yet" answers false, because a
 * redirect cannot be taken back once the real answer arrives.
 */
export function shouldLeavePortal(input: PortalRedirectInput): boolean {
  const { activePortal, authResolved, definitionsLoaded, allowedSlugs } = input;
  if (!activePortal) return false;
  if (!authResolved) return false;
  if (!definitionsLoaded) return false;
  return !allowedSlugs.includes(activePortal);
}
