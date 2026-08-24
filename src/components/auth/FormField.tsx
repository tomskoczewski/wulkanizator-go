import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const inputBase =
  "w-full rounded-xl border bg-slate-50 px-3 py-2.5 pl-10 text-sm font-semibold text-slate-900 placeholder-slate-400 transition-colors focus:bg-white focus:outline-none focus:ring-2";

interface FormFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  icon: ReactNode;
  endContent?: ReactNode;
}

export function FormField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  hint,
  icon,
  endContent,
}: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-bold text-slate-600">
        {label}
      </label>
      <div className="relative">
        <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400">{icon}</span>
        <input
          id={id}
          name={name ?? id}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          className={cn(
            inputBase,
            error ? "border-red-300 focus:ring-red-400" : "border-slate-200 focus:ring-orange-400",
          )}
        />
        {endContent}
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs font-bold text-red-600">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint
      )}
    </div>
  );
}
