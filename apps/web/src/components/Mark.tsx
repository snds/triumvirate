/** The Triumvirate mark: three diamonds as a V, two above and one below. Same geometry as the app loader. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={`mark${className ? ` ${className}` : ''}`} viewBox="96 137 320 238" aria-hidden>
      <path d="M174 145 L244 215 L174 285 L104 215 Z" />
      <path d="M256 227 L326 297 L256 367 L186 297 Z" />
      <path d="M338 145 L408 215 L338 285 L268 215 Z" />
    </svg>
  );
}
