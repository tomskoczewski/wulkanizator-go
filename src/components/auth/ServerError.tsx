import { CircleAlert } from "lucide-react";

interface ServerErrorProps {
  message?: string | null;
}

export function ServerError({ message }: ServerErrorProps) {
  if (!message) return null;

  return (
    <p className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-200">
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
