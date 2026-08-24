import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { UserRole } from "@/types";

const ROLE_LABEL: Record<UserRole, string> = {
  owner: "Właściciel",
  worker: "Pracownik",
};

interface UserMenuProps {
  email: string;
  workshopName: string;
  role: UserRole;
}

export default function UserMenu({ email, workshopName, role }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu konta"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 transition-colors hover:bg-white/30"
      >
        <UserRound size={16} className="text-white" />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-60 rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200">
          <div className="px-3 py-2">
            <p className="truncate text-xs font-black text-slate-900">{email}</p>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
              {workshopName} · {ROLE_LABEL[role]}
            </p>
          </div>
          <div className="my-1 h-px bg-slate-100"></div>
          <form method="POST" action="/api/auth/signout">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={14} />
              Wyloguj
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
