"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/server/form";
import { buttonClass, cn } from "./ui";

type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/** Form bound to a server action, with inline success / error feedback. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <FormFeedback state={state} />
    </form>
  );
}

export function FormFeedback({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("mt-2 text-[12.5px]", state.ok ? "text-match" : "text-exclude")}>
      {state.ok ? state.message ?? "Saved." : state.error}
    </p>
  );
}

export function SubmitButton({ children, variant = "primary", className }: { children: ReactNode; variant?: keyof typeof buttonClass; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(buttonClass[variant], className)}>
      {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Immediate on/off switch backed by a server action. */
export function Toggle({ checked, onChange, label, size = "md" }: { checked: boolean; onChange: (v: boolean) => Promise<ActionResult>; label: string; size?: "sm" | "md" }) {
  // Optimistic value shows instantly and falls back to the server value when the action settles.
  const [value, setValue] = useOptimistic(checked);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={() => {
        const next = !value;
        start(async () => {
          setValue(next);
          await onChange(next);
        });
      }}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        value ? "bg-ink" : "bg-line-strong",
        pending && "opacity-60",
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-white shadow transition",
          size === "sm" ? "size-4" : "size-5",
          value ? (size === "sm" ? "translate-x-[18px]" : "translate-x-[22px]") : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Button that runs a server action (optionally after confirmation) and shows the result. */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "secondary",
  className,
  icon,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  confirm?: string;
  variant?: keyof typeof buttonClass;
  className?: string;
  icon?: "trash";
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        className={cn(buttonClass[variant], className)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setResult(await action()));
        }}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : icon === "trash" ? <Trash2 className="size-3.5" /> : null}
        {children}
      </button>
      {result && !result.ok ? <span className="mt-1 text-[12px] text-exclude">{result.error}</span> : null}
      {result && result.ok && result.message ? <span className="mt-1 text-[12px] text-match">{result.message}</span> : null}
    </span>
  );
}

export function SelectAction<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => Promise<ActionResult>;
  label: string;
  className?: string;
}) {
  const [current, setCurrent] = useOptimistic(value);
  const [pending, start] = useTransition();
  return (
    <select
      aria-label={label}
      value={current}
      disabled={pending}
      className={cn("field h-8 w-auto py-0 pl-2.5 text-[13px]", pending && "opacity-60", className)}
      onChange={(e) => {
        const next = e.target.value as T;
        start(async () => {
          setCurrent(next);
          await onChange(next);
        });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
