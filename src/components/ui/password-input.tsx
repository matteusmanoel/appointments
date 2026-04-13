import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  /** Visível no leitor de tela quando senha oculta */
  showLabel?: string;
  hideLabel?: string;
};

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, showLabel = "Mostrar senha", hideLabel = "Ocultar senha", ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-10", className)}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80"
          aria-label={visible ? hideLabel : showLabel}
        >
          <img
            src={visible ? "/eye-hide.svg" : "/eye-show.svg"}
            alt=""
            width={20}
            height={20}
            className="pointer-events-none opacity-90"
          />
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
