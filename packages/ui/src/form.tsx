import { Label as LabelPrimitive } from "@radix-ui/react-label";
import type { ComponentProps } from "react";
import { cn } from "./lib/utils";

// Form is the native form element. Validation lives in TanStack Form in the app,
// and field errors are announced through a live region (see FormMessage).
export function Form({ className, noValidate = true, ...props }: ComponentProps<"form">) {
  return <form className={cn("space-y-4", className)} noValidate={noValidate} {...props} />;
}

export function FormLabel({ className, ...props }: ComponentProps<typeof LabelPrimitive>) {
  return <LabelPrimitive className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

export function FormMessage({ className, children, ...props }: ComponentProps<"p">) {
  if (!children) return null;
  return (
    <p role="alert" className={cn("text-sm font-medium text-destructive", className)} {...props}>
      {children}
    </p>
  );
}
