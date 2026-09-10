import type { AppointmentStatus } from "@/types";

/**
 * The single answer to "what status should the row show after this failed write" — previously
 * duplicated inline in `DayPlanBoard.advance()` and `AppointmentStatusPanel.changeStatus()`, where
 * the two copies could drift apart unnoticed. Pure, no Supabase import, mirroring
 * `appointment-transitions.ts` beside it.
 */

/**
 * The failure shape this decision reads, declared structurally rather than importing
 * `MutationFailure` from `@/components/hooks/useJsonMutation`: nothing under `src/lib/` imports from
 * `src/components/` today and this must not be the first. `status` and `body` are the only two
 * fields either call site reads, and `MutationFailure` stays structurally assignable, so both
 * callers pass their existing value unchanged.
 */
export interface StatusWriteFailure {
  status?: number;
  body?: unknown;
}

export interface StatusFailureResolution {
  /** The status the surface should display now. */
  status: AppointmentStatus;
  /**
   * `true` when `status` came from the server rather than from the caller's pre-tap value.
   * `DayPlanBoard`'s `onFailure` returns this to suppress `useRowMutation`'s rollback; the detail
   * panel has no rollback to suppress and ignores it.
   */
  resynced: boolean;
}

/**
 * A 409 carries the row's true server-side status in `body.current` — resync to it rather than
 * rolling back to the stale value the caller started from. Every other failure, including a 409
 * that carries no `current` (`slot_taken`, where the row never moved), reverts to `from`.
 *
 * Deliberately unhardened: `current` is cast without checking it is a real enum member, exactly as
 * both call sites did before this extraction. Validating it is a separate change.
 */
export function resolveFailureStatus(from: AppointmentStatus, failure: StatusWriteFailure): StatusFailureResolution {
  if (failure.status === 409) {
    const body = failure.body as { current?: AppointmentStatus } | null;
    if (body?.current) {
      return { status: body.current, resynced: true };
    }
  }

  return { status: from, resynced: false };
}
