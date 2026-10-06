/**
 * Generated artwork. Product photos would need hosting, licensing and a
 * retouching pass; drawn art keeps the catalogue self-contained, offline-safe
 * and consistent with the palette. Each type also carries a tint so the grid
 * has rhythm without every tile being the same box.
 */

const INK = '#0F1D18';
const TEAL = '#0D6B57';
const DEEP = '#084536';
const CORAL = '#E2542C';
const GOLD = '#D9A15B';
const SAND = '#F0DFC4';
const BROWN = '#8A5A33';

const tints = {
  bag: '#F2E7D3',
  tin: '#ECEAE0',
  bottle: '#DCEBE4',
  treat: '#F4E7D6',
  toy: '#FBE3DA',
  rope: '#EFE8D9',
  ball: '#FBE3DA',
  brush: '#DCEBE4',
  collar: '#E5EBE5',
  lead: '#E5EBE5',
  bed: '#EBE6DB',
  blanket: '#EBE6DB',
};

const shapes = {
  bag: `
    <path d="M50 60h100l-9 106a14 14 0 0 1-14 13H73a14 14 0 0 1-14-13Z" fill="${GOLD}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M50 60 61 32h78l11 28Z" fill="#C4863F" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="68" y="94" width="64" height="44" rx="3" fill="${INK}"/>
    <rect x="77" y="104" width="46" height="7" rx="3.5" fill="${SAND}"/>
    <rect x="77" y="117" width="30" height="7" rx="3.5" fill="${CORAL}"/>
    <path d="M76 156h48" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,

  tin: `
    <rect x="52" y="54" width="96" height="94" fill="#D5DAD6" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="100" cy="54" rx="48" ry="16" fill="#EFF2EF" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="100" cy="148" rx="48" ry="16" fill="#C3CAC4" stroke="${INK}" stroke-width="4"/>
    <rect x="52" y="82" width="96" height="42" fill="${TEAL}"/>
    <rect x="64" y="94" width="52" height="7" rx="3.5" fill="${SAND}"/>
    <rect x="64" y="108" width="34" height="7" rx="3.5" fill="${CORAL}"/>
    <path d="M124 46v16" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,

  bottle: `
    <rect x="86" y="44" width="28" height="14" rx="3" fill="${INK}"/>
    <rect x="108" y="44" width="30" height="10" rx="5" fill="${INK}"/>
    <rect x="92" y="58" width="16" height="24" fill="#C3CAC4" stroke="${INK}" stroke-width="4"/>
    <path d="M66 100a14 14 0 0 1 14-14h40a14 14 0 0 1 14 14v70a14 14 0 0 1-14 14H80a14 14 0 0 1-14-14Z" fill="${SAND}" stroke="${INK}" stroke-width="4"/>
    <rect x="74" y="112" width="52" height="46" rx="3" fill="${TEAL}"/>
    <rect x="84" y="124" width="32" height="7" rx="3.5" fill="${SAND}"/>
    <rect x="84" y="138" width="22" height="7" rx="3.5" fill="${CORAL}"/>`,

  treat: `
    <g stroke="${INK}" stroke-width="4">
      <g fill="#E0BE8E">
        <rect x="56" y="86" width="88" height="30" rx="15"/>
        <circle cx="58" cy="84" r="18"/><circle cx="58" cy="118" r="18"/>
        <circle cx="142" cy="84" r="18"/><circle cx="142" cy="118" r="18"/>
      </g>
      <g fill="#E0BE8E" stroke="none">
        <rect x="56" y="86" width="88" height="30" rx="15"/>
        <circle cx="58" cy="84" r="18"/><circle cx="58" cy="118" r="18"/>
        <circle cx="142" cy="84" r="18"/><circle cx="142" cy="118" r="18"/>
      </g>
    </g>
    <path d="M78 96h44M78 108h30" stroke="${BROWN}" stroke-width="4" stroke-linecap="round"/>`,

  toy: `
    <path d="M100 34c34 0 56 32 56 66 0 38-27 66-56 66s-56-28-56-66c0-34 22-66 56-66Z" fill="#3F7A52" stroke="${INK}" stroke-width="4"/>
    <path d="M100 62c22 0 36 22 36 44 0 26-17 44-36 44s-36-18-36-44c0-22 14-44 36-44Z" fill="#DDE9A6" stroke="${INK}" stroke-width="4"/>
    <circle cx="100" cy="112" r="21" fill="${BROWN}" stroke="${INK}" stroke-width="4"/>
    <path d="M100 34c-8-10-20-14-30-13" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,

  rope: `
    <circle cx="52" cy="100" r="30" fill="#E0BE8E" stroke="${INK}" stroke-width="4"/>
    <circle cx="148" cy="100" r="30" fill="#E0BE8E" stroke="${INK}" stroke-width="4"/>
    <rect x="46" y="78" width="108" height="44" rx="22" fill="#E0BE8E" stroke="${INK}" stroke-width="4"/>
    <path d="M66 80 52 122M88 80 74 122M110 80 96 122M132 80 118 122M154 80 140 122" stroke="${TEAL}" stroke-width="7" stroke-linecap="round"/>`,

  ball: `
    <circle cx="100" cy="100" r="62" fill="#DCE36E" stroke="${INK}" stroke-width="4"/>
    <path d="M55 58c22 18 22 66 0 84M145 58c-22 18-22 66 0 84" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M78 46c14 22 14 86 0 108" fill="none" stroke="#B7C13F" stroke-width="5" stroke-linecap="round"/>
    <path d="M122 46c-14 22-14 86 0 108" fill="none" stroke="#B7C13F" stroke-width="5" stroke-linecap="round"/>`,

  brush: `
    <g transform="rotate(-24 100 100)">
      <rect x="46" y="104" width="112" height="40" rx="20" fill="${BROWN}" stroke="${INK}" stroke-width="4"/>
      <path d="M56 104V72M74 104V66M92 104V66M110 104V66M128 104V66M146 104V72" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
      <rect x="46" y="94" width="112" height="26" rx="8" fill="${TEAL}" stroke="${INK}" stroke-width="4"/>
      <rect x="66" y="116" width="72" height="14" rx="7" fill="${SAND}"/>
    </g>`,

  collar: `
    <circle cx="100" cy="90" r="50" fill="none" stroke="${INK}" stroke-width="28"/>
    <circle cx="100" cy="90" r="50" fill="none" stroke="${CORAL}" stroke-width="20"/>
    <rect x="86" y="34" width="28" height="18" rx="4" fill="${INK}"/>
    <rect x="92" y="38" width="16" height="10" rx="2" fill="${tints.collar}"/>
    <path d="M100 140v10" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="100" cy="162" r="16" fill="#E7C79A" stroke="${INK}" stroke-width="4"/>
    <path d="M94 162h12" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,

  lead: `
    <path d="M44 158c0-58 112-38 112-104" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>
    <path d="M44 158c0-58 112-38 112-104" fill="none" stroke="${TEAL}" stroke-width="12" stroke-linecap="round"/>
    <rect x="138" y="34" width="34" height="20" rx="6" fill="#C3CAC4" stroke="${INK}" stroke-width="4"/>
    <path d="M146 34v-8a9 9 0 0 1 18 0v8" fill="none" stroke="${INK}" stroke-width="4"/>
    <circle cx="44" cy="158" r="15" fill="#C3CAC4" stroke="${INK}" stroke-width="4"/>`,

  bed: `
    <path d="M22 124c0-46 34-74 78-74s78 28 78 74Z" fill="#C9B79A" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <ellipse cx="100" cy="134" rx="78" ry="38" fill="#D9C7AA" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="100" cy="126" rx="54" ry="25" fill="#EFE7D6" stroke="${INK}" stroke-width="4"/>
    <path d="M74 124c14-8 38-8 52 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,

  blanket: `
    <path d="M34 62h132v70a26 26 0 0 1-26 26H60a26 26 0 0 1-26-26Z" fill="#C9B79A" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M34 62c0-12 10-22 22-22h88c12 0 22 10 22 22" fill="#D9C7AA" stroke="${INK}" stroke-width="4"/>
    <path d="M34 96h132M34 122h132" stroke="${TEAL}" stroke-width="6"/>
    <path d="M62 40v118M100 40v118M138 40v118" stroke="${INK}" stroke-width="3" opacity=".35"/>`,
};

export function tintFor(type) {
  return tints[type] || '#ECEFE9';
}

export function productArt(type, label = '') {
  const body = shapes[type] || shapes.bag;
  return `<svg viewBox="0 0 200 200" role="img" aria-label="${String(label).replace(/"/g, '')}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** Inline brand mark: a pair of grooming scissors. */
export const brandMark = `<svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
  <circle cx="7.5" cy="25" r="4.6"/><circle cx="24.5" cy="25" r="4.6"/>
  <path d="M10.6 21.6 24.8 4.6"/><path d="M21.4 21.6 7.2 4.6"/>
  <circle cx="16" cy="14.6" r="1.7" fill="currentColor" stroke="none"/>
</svg>`;
