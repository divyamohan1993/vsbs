// Fixed full-bleed background that sits behind every page. Pure CSS, no JS.
// Renders the aurora gradient + grain defined in globals.css. Drop one of these
// inside <body> as the first child; siblings keep their natural stacking.

export function AuroraGradient(): React.JSX.Element {
  return <div aria-hidden="true" className="luxe-aurora" />;
}
