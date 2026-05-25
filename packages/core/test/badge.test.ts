import { describe, it, expect } from 'vitest';

import { renderBadgeMarkdown, renderBadgeSvg } from '../src/badge.js';

describe('renderBadgeSvg', () => {
  it('renders a complete SVG with passportsign label and CAN value', () => {
    const svg = renderBadgeSvg({
      github_username: 'johnf',
      issuing_country: 'CAN',
      bound_at: '2026-05-25T10:30:00.000Z',
    });

    expect(svg).toMatch(/^<svg/);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).toContain('passportsign');
    expect(svg).toContain('CAN');
    expect(svg).toContain('2026-05-25');
    expect(svg).toContain('verified human');
  });

  it('omits country when issuing_country is null', () => {
    const svg = renderBadgeSvg({
      github_username: 'johnf',
      issuing_country: null,
      bound_at: '2026-05-25T10:30:00.000Z',
    });

    expect(svg).toContain('verified human');
    expect(svg).toContain('2026-05-25');
    // The country slot shouldn't show; the only middle dot is between value parts.
    // Confirm there is exactly one middle-dot separator between "human" and date.
    const matches = svg.match(/verified human · 2026-05-25/);
    expect(matches).toBeTruthy();
  });

  it('width grows with the value text length', () => {
    const short = renderBadgeSvg({
      github_username: 'a',
      issuing_country: null,
      bound_at: '2026-05-25T10:30:00.000Z',
    });
    const long = renderBadgeSvg({
      github_username: 'a',
      issuing_country: 'CAN',
      bound_at: '2026-05-25T10:30:00.000Z',
    });
    const widthOf = (svg: string): number => Number(/width="(\d+)"/.exec(svg)![1]);
    expect(widthOf(long)).toBeGreaterThan(widthOf(short));
  });

  it('escapes XML-special characters in inputs', () => {
    const svg = renderBadgeSvg({
      github_username: 'evil-user',
      issuing_country: '<script>alert(1)</script>',
      bound_at: '2026-05-25T10:30:00.000Z',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('contains a tooltip with the (truncated) Rekor UUID when provided', () => {
    const svg = renderBadgeSvg({
      github_username: 'johnf',
      issuing_country: 'CAN',
      bound_at: '2026-05-25T10:30:00.000Z',
      log_entry_hash: '108e9186e8c5677a083861840595aefe2c2b960164213d8a439199a631d8df3a2ec2b2cf6a27d326',
    });
    expect(svg).toMatch(/<title>[^<]*rekor entry 108e9186e8c5677a[^<]*<\/title>/);
  });

  it('falls back gracefully on malformed bound_at', () => {
    const svg = renderBadgeSvg({
      github_username: 'johnf',
      issuing_country: 'CAN',
      bound_at: 'not-a-date',
    });
    // Should still render something for the date slot (the leading 10 chars).
    expect(svg).toContain('not-a-dat');
  });
});

describe('renderBadgeMarkdown', () => {
  it('builds a click-through markdown image linking to Rekor', () => {
    const md = renderBadgeMarkdown({
      badge_path: './passportsign-badge.svg',
      log_entry_hash: 'abc123',
    });
    expect(md).toBe(
      '[![passportsign verified](./passportsign-badge.svg)](https://rekor.sigstore.dev/api/v1/log/entries/abc123)',
    );
  });

  it('honors a custom rekor base url', () => {
    const md = renderBadgeMarkdown({
      badge_path: './b.svg',
      log_entry_hash: 'x',
      rekor_base_url: 'https://rekor.example',
    });
    expect(md).toContain('https://rekor.example/api/v1/log/entries/x');
  });

  it('honors a custom alt text', () => {
    const md = renderBadgeMarkdown({
      badge_path: './b.svg',
      log_entry_hash: 'x',
      alt_text: 'passportsign verified · CAN · 2026-05-25',
    });
    expect(md).toContain('![passportsign verified · CAN · 2026-05-25]');
  });
});
