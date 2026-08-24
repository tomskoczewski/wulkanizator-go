import { useCallback, useState } from "react";

export interface MutationFailure {
  fieldErrors?: Record<string, string[] | undefined>;
  message?: string;
  status?: number;
  body?: unknown;
}

interface ErrorResponseBody {
  errors?: Record<string, string[] | undefined>;
  error?: string;
}

export type MutationResult<TResponse> = { ok: true; data: TResponse } | { ok: false; failure: MutationFailure };

/**
 * First message from a zod `flattenError().fieldErrors` payload, whichever field failed.
 * The server only returns keys that actually failed, so indexing a hard-coded key is unsafe:
 * a request carrying several fields can be rejected on one the caller wasn't expecting.
 */
export function firstFieldError(fieldErrors?: Record<string, string[] | undefined>): string | undefined {
  if (!fieldErrors) return undefined;
  for (const messages of Object.values(fieldErrors)) {
    if (messages?.[0]) return messages[0];
  }
  return undefined;
}

/**
 * Stateless PATCH/POST/PUT + JSON parsing. Every settings mutation goes through this so a network
 * rejection can never escape as an unhandled promise — it comes back as `{ ok: false }` like any
 * other failure. Stateful callers wrap it: `useJsonMutation` for a single form, `useRowMutation`
 * for a list where each row needs its own pending/error state.
 */
export async function requestJson<TResponse>(
  url: string,
  method: string,
  body: unknown,
): Promise<MutationResult<TResponse>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as ErrorResponseBody | TResponse | null;

    if (!res.ok) {
      const failure = json as ErrorResponseBody | null;
      return {
        ok: false,
        failure: {
          fieldErrors: failure?.errors,
          message: failure?.error ?? "Coś poszło nie tak. Spróbuj ponownie.",
          status: res.status,
          body: json,
        },
      };
    }

    return { ok: true, data: json as TResponse };
  } catch {
    return { ok: false, failure: { message: "Nie udało się połączyć z serwerem." } };
  }
}

/**
 * Shared PATCH/POST/PUT + JSON parsing for the settings island's optimistic-update pattern:
 * caller applies the change to local state immediately, calls `mutate`, and reverts on a null
 * return while reading `error.fieldErrors` to show the server's validation message inline.
 */
export function useJsonMutation<TResponse>() {
  const [error, setError] = useState<MutationFailure | null>(null);
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(async (url: string, method: string, body: unknown): Promise<TResponse | null> => {
    setIsPending(true);
    setError(null);
    try {
      const result = await requestJson<TResponse>(url, method, body);
      if (!result.ok) {
        setError(result.failure);
        return null;
      }
      return result.data;
    } finally {
      setIsPending(false);
    }
  }, []);

  return {
    mutate,
    error,
    isPending,
    clearError: () => {
      setError(null);
    },
  };
}

/**
 * Per-row variant for lists (services, bays, weekday hours). Pending and error state are keyed, so
 * one row's response can never re-enable or clear another row's — the bug a single shared
 * `isPending` flag produces when two rows are edited in quick succession.
 *
 * `rollback` runs on failure and must be a functional state update that touches only this row;
 * reverting to a whole-list snapshot would undo a concurrent mutation that actually succeeded.
 * `onFailure`, if given, gets the raw `MutationFailure` and can return `true` to suppress the
 * rollback — for a 409 that carries the row's true server-side state, resyncing to it is the
 * correct response, not reverting to the caller's stale optimistic value.
 */
export function useRowMutation() {
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const run = useCallback(
    async (
      key: string,
      request: { url: string; method: string; body: unknown },
      handlers: {
        rollback: () => void;
        fallbackMessage: string;
        onFailure?: (failure: MutationFailure) => boolean;
      },
    ): Promise<boolean> => {
      setPendingKeys((prev) => new Set(prev).add(key));
      setRowErrors((prev) => ({ ...prev, [key]: "" }));

      try {
        const result = await requestJson<unknown>(request.url, request.method, request.body);

        if (!result.ok) {
          const handled = handlers.onFailure?.(result.failure) ?? false;
          if (!handled) handlers.rollback();
          setRowErrors((prev) => ({
            ...prev,
            [key]: firstFieldError(result.failure.fieldErrors) ?? result.failure.message ?? handlers.fallbackMessage,
          }));
          return false;
        }

        return true;
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  return {
    run,
    isPending: (key: string) => pendingKeys.has(key),
    rowErrors,
  };
}
