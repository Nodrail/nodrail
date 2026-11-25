const sources = {
  horizontal: "/brand/horizontal-primary.svg",
  symbol: "/brand/symbol-primary.svg",
} as const;

type LogoProps = Omit<React.ComponentProps<"img">, "src"> & {
  variant?: keyof typeof sources;
};

/** The symbol is decorative by default; pass `alt` when it stands alone. */
export function Logo({ variant = "horizontal", alt, ...props }: LogoProps) {
  return (
    <img
      src={sources[variant]}
      alt={alt ?? (variant === "horizontal" ? "nodrail" : "")}
      {...props}
    />
  );
}
