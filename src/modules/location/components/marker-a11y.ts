import type { Marker as MapboxMarker } from "mapbox-gl";

/**
 * Mapbox stamps every marker wrapper with `role="img"` and the English
 * `aria-label="Map marker"`. Pass the result as a react-map-gl `<Marker ref>`:
 * with a label the wrapper gets Korean copy; with `null` the role and label are
 * removed so the interactive child (which carries its own name) is what a screen
 * reader announces — a `role="img"` parent would otherwise flatten that button.
 */
export function markerA11yRef(label: string | null) {
  return (marker: MapboxMarker | null) => {
    const el = marker?.getElement();
    if (!el) return;
    if (label) {
      el.setAttribute("aria-label", label);
    } else {
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
    }
  };
}
