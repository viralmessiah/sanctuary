import * as React from "react"

// Neutral placeholder (inline SVG, no external request) for missing or broken images.
const FALLBACK_IMAGE_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='#e2e8f0'/>" +
    "<path d='M14 46l12-14 9 10 6-7 9 11z' fill='#94a3b8'/><circle cx='24' cy='22' r='5' fill='#94a3b8'/></svg>"
  )

/**
 * <img> that falls back to a placeholder when there is no src or the file fails to load.
 * Extra props used by older callers (fittingType, quality, ...) are accepted and ignored;
 * use CSS (object-cover, ...) for fitting.
 */
const Image = React.forwardRef(
  ({ src, fittingType, originWidth, originHeight, focalPointX, focalPointY, quality, onError, alt = "", ...props }, ref) => {
    const [failed, setFailed] = React.useState(false)
    React.useEffect(() => setFailed(false), [src])
    const showFallback = !src || failed
    return (
      <img
        ref={ref}
        src={showFallback ? FALLBACK_IMAGE_URL : src}
        alt={alt}
        loading="lazy"
        {...props}
        className={`object-cover ${props.className || ""}`.trim()}
        onError={(event) => {
          if (!showFallback) {
            setFailed(true)
            onError?.(event)
          }
        }}
      />
    )
  }
)
Image.displayName = "Image"

export { Image }
