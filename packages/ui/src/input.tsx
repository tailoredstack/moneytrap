import type { ComponentProps } from "react";
import { cn } from "./lib/utils";

// Copied from shadcn/ui; edit here when Moneytrap needs a change.
export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
