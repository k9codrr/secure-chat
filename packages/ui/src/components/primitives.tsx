"use client";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { haptic } from "../lib/native";

/** Spring used for every sliding selection indicator (tab bar, folders, segmented controls). */
export const PILL_SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.8 } as const;

const buttonVariants = cva(
  "pressable inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 select-none",
  {
    variants: {
      variant: {
        primary: "accent-fill text-accent-contrast",
        secondary: "bg-surface text-text hover:bg-surface-2",
        ghost: "text-text hover:bg-surface",
        outline: "border border-border text-text hover:bg-surface",
        glass: "glass text-text",
        danger: "bg-danger text-white hover:opacity-90",
        link: "text-accent hover:underline px-0",
      },
      size: {
        sm: "h-9 px-3.5 text-sm rounded-full",
        md: "h-11 px-5 text-[15px] rounded-full",
        lg: "h-[52px] px-6 text-[16px] rounded-full",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  noHaptic?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, onClick, noHaptic, disabled, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(buttonVariants({ variant, size }), className)}
    disabled={disabled || loading}
    onClick={(e) => {
      if (!noHaptic) void haptic("light");
      onClick?.(e);
    }}
    {...props}
  >
    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
    {children}
  </button>
));
Button.displayName = "Button";

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(({ label, className, variant = "ghost", ...p }, ref) => (
  <Button ref={ref} aria-label={label} title={label} variant={variant} size="icon" className={cn("text-muted hover:text-text", className)} {...p} />
));
IconButton.displayName = "IconButton";

/** Round floating glass button, as used in headers over content. */
export const GlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; accent?: boolean }>(
  ({ label, className, accent, children, onClick, ...p }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      onClick={(e) => {
        void haptic("light");
        onClick?.(e);
      }}
      className={cn(
        "pressable flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50",
        accent ? "accent-fill-float text-accent-contrast" : "glass text-text",
        className,
      )}
      {...p}
    >
      {children}
    </button>
  ),
);
GlassButton.displayName = "GlassButton";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; trailing?: ReactNode }>(
  ({ className, leading, trailing, ...p }, ref) => (
    <div className={cn("flex h-11 items-center gap-2 rounded-xl bg-surface px-3.5 ring-accent/50 transition focus-within:ring-2", className)}>
      {leading && <span className="text-muted">{leading}</span>}
      <input ref={ref} className="h-full w-full min-w-0 bg-transparent text-[16px] text-text outline-none placeholder:text-subtle" {...p} />
      {trailing}
    </div>
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("w-full resize-none rounded-xl bg-surface px-3.5 py-2.5 text-[16px] text-text outline-none ring-accent/50 placeholder:text-subtle focus:ring-2", className)} {...p} />
));
Textarea.displayName = "Textarea";

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <SwitchPrimitive.Root
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => {
        void haptic("light");
        onCheckedChange(v);
      }}
      className="relative h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full bg-surface-2 transition-colors duration-300 data-[state=checked]:bg-online disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block h-[27px] w-[27px] translate-x-[2px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-300 [transition-timing-function:var(--ease-spring)] will-change-transform data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-accent", className)} />;
}

export function Badge({ children, muted, className }: { children: ReactNode; muted?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[13px] font-semibold tabular-nums", muted ? "bg-subtle text-white" : "bg-accent text-accent-contrast", className)}>
      {children}
    </span>
  );
}

export function Section({ title, children, footer, className }: { title?: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-6", className)}>
      {title && <h3 className="mb-1.5 px-5 text-[13px] font-normal uppercase tracking-[0.02em] text-muted">{title}</h3>}
      <div className="overflow-hidden rounded-[26px] bg-card">{children}</div>
      {footer && <p className="mt-1.5 px-5 text-[13px] text-muted">{footer}</p>}
    </section>
  );
}

/** Coloured rounded-square icon, the iOS settings look. */
export function TileIcon({ color, children, size = 30 }: { color: string; children: ReactNode; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[8px] text-white [&_svg]:h-[62%] [&_svg]:w-[62%]"
      style={{ width: size, height: size, background: `linear-gradient(180deg, color-mix(in srgb, ${color} 82%, white), ${color})` }}
    >
      {children}
    </span>
  );
}

export function Row({
  icon,
  tint,
  title,
  subtitle,
  trailing,
  value,
  onClick,
  danger,
  accentTitle,
  className,
}: {
  icon?: ReactNode;
  /** When set, the icon is drawn white on a rounded square of this colour. */
  tint?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** Muted value shown before the trailing element (e.g. "4", "English"). */
  value?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  accentTitle?: boolean;
  className?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={
        onClick
          ? () => {
              void haptic("light");
              onClick();
            }
          : undefined
      }
      data-icon={icon ? "" : undefined}
      className={cn(
        // Separators start after the icon, like iOS grouped lists.
        "relative flex min-h-[52px] w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors duration-150",
        "[&+&]:before:absolute [&+&]:before:right-0 [&+&]:before:top-0 [&+&]:before:h-px [&+&]:before:bg-border [&+&]:before:content-['']",
        icon ? "[&+&]:before:left-[62px]" : "[&+&]:before:left-4",
        onClick && "hover:bg-surface-2/50 active:bg-surface-2",
        className,
      )}
    >
      {icon &&
        (tint ? (
          <TileIcon color={tint}>{icon}</TileIcon>
        ) : (
          <span className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center", danger ? "text-danger" : "text-accent")}>{icon}</span>
        ))}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[16.5px]", danger && "text-danger", accentTitle && "text-accent")}>{title}</span>
        {subtitle && <span className="block truncate text-[13.5px] text-muted">{subtitle}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 text-[16px] text-muted">{value}</span>}
      {trailing}
    </Comp>
  );
}

/** Glass capsule with a sliding selection pill. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("glass flex rounded-full p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => {
            if (o.value === value) return;
            void haptic("selection");
            onChange(o.value);
          }}
          className={cn("relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-[7px] text-[15px] font-semibold transition-colors duration-200", value === o.value ? "text-text" : "text-muted hover:text-text")}
        >
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="glass-pill absolute inset-0 rounded-full" transition={PILL_SPRING} />}
          <span className="relative flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <div className="glass flex h-[76px] w-[76px] items-center justify-center rounded-full text-accent">{icon}</div>
      <h3 className="mt-1 text-[22px] font-bold tracking-[-0.02em]">{title}</h3>
      {body && <p className="max-w-xs text-[15px] leading-relaxed text-muted">{body}</p>}
      {action}
    </motion.div>
  );
}

/** Centred title bar with glass buttons either side; used at the top of every main screen. */
export function ScreenHeader({ left, title, right, children, className }: { left?: ReactNode; title?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn("safe-top relative z-10 shrink-0 px-4 pb-2", className)}>
      <div className="grid h-[60px] grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-2">{left}</div>
        <div className="flex min-w-0 items-center justify-center gap-2 text-[17px] font-semibold">{title}</div>
        <div className="flex items-center justify-end gap-2">{right}</div>
      </div>
      {children}
    </header>
  );
}
