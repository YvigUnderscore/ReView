import { describe, expect, it } from 'vitest';
import { renderDocHtml } from './docsRender';

describe('renderDocHtml', () => {
  it('transforme les liens internes .md en data-doc résolu', () => {
    const html = renderDocHtml('[Errors](../api/errors.md)', 'user-guide/review-video.md');
    expect(html).toContain('data-doc="api/errors.md"');
    expect(html).not.toContain('href="../api/errors.md"');
  });

  it('ouvre les liens externes dans un nouvel onglet', () => {
    const html = renderDocHtml('[Site](https://example.com)', 'README.md');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('réécrit les images relatives vers /docs/', () => {
    const html = renderDocHtml('![cap](../assets/user-guide/review-01.png)', 'user-guide/a.md');
    expect(html).toContain('src="/docs/assets/user-guide/review-01.png"');
  });

  it('échappe le HTML brut (convention : markdown pur)', () => {
    const html = renderDocHtml('hello <script>alert(1)</script>', 'README.md');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rend les titres et le code', () => {
    const html = renderDocHtml('# Title\n\n`code`', 'README.md');
    expect(html).toContain('<h1');
    expect(html).toContain('<code>code</code>');
  });
});
