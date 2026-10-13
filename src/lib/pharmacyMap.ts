/**
 * Leaflet helpers for the nearby-pharmacies map: map-pin icons, the user's
 * blue dot, cluster bubbles and the pharmacy popup.
 *
 * Leaflet must be imported before leaflet.markercluster: Leaflet sets
 * window.L, which the plugin extends with L.markerClusterGroup.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";

export { L };

const PIN_COLOR = "#0d9488"; // teal-600, the app's secondary colour
const PIN_SELECTED_COLOR = "#2563eb"; // primary blue for the selected pharmacy

/** Escapes text from OpenStreetMap before it goes into popup HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Teardrop pin with a white medical cross; the tip is the exact location. */
function pinSvg(color: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 32 42" aria-hidden="true">
  <path d="M16 1C7.7 1 1 7.6 1 15.8c0 10.9 13.3 24 14.1 24.8a1.3 1.3 0 0 0 1.8 0C17.7 39.8 31 26.7 31 15.8 31 7.6 24.3 1 16 1z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
  <circle cx="16" cy="15.5" r="9" fill="#ffffff" fill-opacity="0.18"/>
  <path d="M13.6 9.5h4.8v3.7h3.7v4.8h-3.7v3.7h-4.8V18H9.9v-4.8h3.7z" fill="#ffffff"/>
</svg>`;
}

export function pharmacyPinIcon(selected = false): L.DivIcon {
  const [w, h] = selected ? [40, 52] : [32, 42];
  return L.divIcon({
    className: selected ? "pharm-pin pharm-pin--selected" : "pharm-pin",
    html: pinSvg(selected ? PIN_SELECTED_COLOR : PIN_COLOR, w, h),
    iconSize: [w, h],
    iconAnchor: [w / 2, h], // bottom tip of the pin
    popupAnchor: [0, -h + 4], // popup opens just above the pin
  });
}

/** The user's position: blue dot with a soft halo. */
export function userDotIcon(): L.DivIcon {
  return L.divIcon({
    className: "user-dot",
    html: '<span class="user-dot__halo"></span><span class="user-dot__core"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

/** Teal bubble showing how many pharmacies are grouped together. */
export function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const size = count < 10 ? 36 : count < 50 ? 42 : 48;
  return L.divIcon({
    className: "pharm-cluster",
    html: `<span>${count}</span>`,
    iconSize: [size, size],
  });
}

export interface PharmacyPopupData {
  name: string;
  address: string;
  distanceLabel: string;
  /** e.g. "Open 24 hours" or "Hours: Mo-Sa 09:00-21:00"; null when unknown. */
  hoursLabel: string | null;
  /** Only a real listed number; null hides the Call button. */
  phone: string | null;
  callLabel: string;
  directionsLabel: string;
  directionsUrl: string;
}

/** Popup shown when a pin is tapped. All text is escaped. */
export function pharmacyPopupHtml(d: PharmacyPopupData): string {
  const phone = d.phone ? d.phone.replace(/[^\d+]/g, "") : "";
  return `<div class="pharm-popup">
  <p class="pharm-popup__name">${escapeHtml(d.name)}</p>
  ${d.address ? `<p class="pharm-popup__address">${escapeHtml(d.address)}</p>` : ""}
  <p class="pharm-popup__meta">
    ${d.hoursLabel ? `<span class="pharm-popup__status is-open">${escapeHtml(d.hoursLabel)}</span>` : ""}
    <span>📍 ${escapeHtml(d.distanceLabel)}</span>
  </p>
  <div class="pharm-popup__actions">
    ${phone ? `<a class="pharm-popup__btn pharm-popup__btn--call" href="tel:${phone}">${escapeHtml(d.callLabel)}</a>` : ""}
    <a class="pharm-popup__btn pharm-popup__btn--dir" href="${escapeHtml(d.directionsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.directionsLabel)} ➔</a>
  </div>
</div>`;
}
