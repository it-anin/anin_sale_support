interface AnimatedLogoTextProps {
  text: string;
}

const NBSP = String.fromCharCode(160);

// Splits text into per-letter spans so each character can blur-in with a staggered delay (.logo-letter in App.css)
export function AnimatedLogoText({ text }: AnimatedLogoTextProps) {
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} className="logo-letter" style={{ animationDelay: `${i * 0.05}s` }}>
          {ch === ' ' ? NBSP : ch}
        </span>
      ))}
    </>
  );
}
