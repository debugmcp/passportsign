/**
 * Self-contained inline SVG badge generator for passportsign.
 *
 * v0 ships without a hosted badge service. Maintainers commit the
 * generated `passportsign-badge.svg` to a public repo (typically the
 * `username/username` profile repo) and reference it from their
 * README. GitHub's image proxy renders the SVG; the badge wraps a
 * link to the Rekor entry for click-through verification.
 *
 * Visual: shields.io-style pill, two segments, ~190-280px wide
 * depending on text. Renders with the 10x scale + transform=scale(.1)
 * trick used by shields.io for crisper text rendering.
 */

export interface BadgeInput {
  github_username: string;
  issuing_country: string | null;
  bound_at: string;            // ISO 8601 timestamp
  /** Rekor entry UUID for the `<title>` tooltip. */
  log_entry_hash?: string;
}

const LABEL = 'passportsign';
const CHAR_WIDTH_PX = 7;        // Approx Verdana 11pt character width
const SIDE_PADDING_PX = 8;

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

function dateStringFor(isoTimestamp: string): string {
  // Render as YYYY-MM-DD for the badge.
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Render the badge SVG. The output is intentionally a string (not a
 * DOM tree or stream) so callers can write it to disk directly with
 * `writeFileSync`.
 */
export function renderBadgeSvg(input: BadgeInput): string {
  const date = dateStringFor(input.bound_at);
  const valueParts = ['verified human'];
  if (input.issuing_country) valueParts.push(input.issuing_country);
  valueParts.push(date);
  const valueText = valueParts.join(' · '); // middle dot ·

  const labelEsc = escapeXml(LABEL);
  const valueEsc = escapeXml(valueText);

  const labelW = LABEL.length * CHAR_WIDTH_PX + 2 * SIDE_PADDING_PX;
  const valueW = valueText.length * CHAR_WIDTH_PX + 2 * SIDE_PADDING_PX;
  const totalW = labelW + valueW;

  const labelCx10 = labelW * 5;          // centre of label segment, scaled x10
  const valueCx10 = (labelW + valueW / 2) * 10;
  const ariaLabel = `${labelEsc}: ${valueEsc}`;
  const tooltipExtra = input.log_entry_hash
    ? ` (rekor entry ${escapeXml(input.log_entry_hash.slice(0, 16))}…)`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${ariaLabel}">`,
    `<title>${ariaLabel}${tooltipExtra}</title>`,
    `<linearGradient id="s" x2="0" y2="100%">`,
    `<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>`,
    `<stop offset="1" stop-opacity=".1"/>`,
    `</linearGradient>`,
    `<clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelW}" height="20" fill="#555"/>`,
    `<rect x="${labelW}" width="${valueW}" height="20" fill="#4c1"/>`,
    `<rect width="${totalW}" height="20" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">`,
    `<text x="${labelCx10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${labelEsc}</text>`,
    `<text x="${labelCx10}" y="140" transform="scale(.1)">${labelEsc}</text>`,
    `<text x="${valueCx10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${valueEsc}</text>`,
    `<text x="${valueCx10}" y="140" transform="scale(.1)">${valueEsc}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

/**
 * Render the Markdown snippet that wraps the badge in a click-through
 * link to the Rekor entry. Suitable for pasting into a README.
 */
export function renderBadgeMarkdown(input: {
  badge_path: string;            // relative path the user will commit
  log_entry_hash: string;        // Rekor entry UUID
  rekor_base_url?: string;       // default: https://rekor.sigstore.dev
  alt_text?: string;
}): string {
  const base = input.rekor_base_url ?? 'https://rekor.sigstore.dev';
  const url = `${base}/api/v1/log/entries/${input.log_entry_hash}`;
  const alt = input.alt_text ?? 'passportsign verified';
  return `[![${alt}](${input.badge_path})](${url})`;
}
