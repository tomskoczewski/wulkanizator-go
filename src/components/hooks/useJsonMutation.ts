import { useCallback, useState } from "react";

export interface MutationFailure {
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

interface ErrorResponseBody {
  errors?: Record<string, string[]>;
  error?: string;
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
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as ErrorResponseBody | TResponse | null;

      if (!res.ok) {
        const failure = json as ErrorResponseBody | null;
        setError({
          fieldErrors: failure?.errors,
          message: failure?.error ?? "Coś poszło nie tak. Spróbuj ponownie.",
        });
        return null;
      }

      return json as TResponse;
    } catch {
      setError({ message: "Nie udało się połączyć z serwerem." });
      return null;
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
