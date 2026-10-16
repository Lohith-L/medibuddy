// The MediBuddy logo. Images are built by scripts/generate-brand-assets.py
// from resources/logo-full.png; dark mode swaps in the light-text versions.
import logoFull from "@/assets/brand/logo-full.png";
import logoFullDark from "@/assets/brand/logo-full-dark.png";
import logoHorizontal from "@/assets/brand/logo-horizontal.png";
import logoHorizontalDark from "@/assets/brand/logo-horizontal-dark.png";
import logoSymbol from "@/assets/brand/logo-symbol.png";

interface Props {
  /** full: symbol + name + tagline · horizontal: symbol + name · symbol: heart/hand/cross only */
  variant?: "full" | "horizontal" | "symbol";
  /** Size the logo with a height class, e.g. "h-10" (width follows). */
  className?: string;
}

const SOURCES = {
  full: [logoFull, logoFullDark],
  horizontal: [logoHorizontal, logoHorizontalDark],
  symbol: [logoSymbol, logoSymbol],
} as const;

const BrandLogo = ({ variant = "horizontal", className = "h-10" }: Props) => {
  const [light, dark] = SOURCES[variant];
  const alt = variant === "full" ? "MediBuddy - Your Smart Health Companion" : "MediBuddy";
  if (light === dark) {
    return <img src={light} alt={alt} className={`w-auto select-none ${className}`} draggable={false} />;
  }
  return (
    <>
      <img src={light} alt={alt} className={`w-auto select-none dark:hidden ${className}`} draggable={false} />
      <img src={dark} alt={alt} className={`w-auto select-none hidden dark:block ${className}`} draggable={false} />
    </>
  );
};

export default BrandLogo;
