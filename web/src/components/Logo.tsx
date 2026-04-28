import Image from "next/image";

/**
 * Default site/brand logo (TTNAWA crest).
 * Stored locally at /brand/logo.jpg so we never depend on external CDNs.
 * Prefer this component anywhere we'd otherwise fall back to plain text
 * branding; pass `src` only to override (e.g. per-event logo_url).
 */
export const DEFAULT_LOGO_SRC = "/brand/logo.jpg";

export default function Logo({
  src,
  size = 40,
  alt = "TTNAWA — Tamil Nadu Arm Wrestling Association",
  className = "",
  priority = false,
}: {
  src?: string | null;
  size?: number;
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  const finalSrc = src && src.length > 0 ? src : DEFAULT_LOGO_SRC;
  // Use unoptimized for remote (event logo_url) and next/image for local.
  const isRemote = finalSrc.startsWith("http");
  if (isRemote) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={finalSrc}
        alt={alt}
        width={size}
        height={size}
        className={`inline-block rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <Image
      src={finalSrc}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={`inline-block rounded-full object-cover ${className}`}
    />
  );
}
