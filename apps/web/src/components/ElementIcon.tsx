import type { CSSProperties } from 'react';

/**
 * Bungie's element icons are white silhouettes. Using one as a CSS mask lets the
 * element color token paint it, so Solar is orange, Arc is cyan, and so on.
 */
export function ElementIcon({ damage, icon, className }: { damage?: string; icon?: string; className?: string }) {
  if (!icon) return null;
  const style = {
    '--element-icon': `url("${sameOrigin(icon)}")`,
    '--element-color': damage ? `var(--element-${damage.toLowerCase()}, currentColor)` : 'currentColor',
  } as CSSProperties;
  return <span className={`element-icon ${className ?? ''}`} style={style} aria-hidden="true" />;
}

/** Routes Bungie images through our server, since CSS masks need same-origin (or CORS) images. */
const sameOrigin = (url: string) => url.replace(/^https:\/\/www\.bungie\.net\//, '/api/bungie-img/');
