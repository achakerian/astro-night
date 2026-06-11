/**
 * Lightweight Wikipedia popup. Given a page title it fetches the article
 * summary from Wikipedia's CORS-enabled REST API and shows it in a modal card,
 * with a link out to the full article. Network is only touched on click — the
 * star map itself stays fully static/offline.
 */
export class WikiPopup {
  private readonly overlay: HTMLElement;
  private readonly content: HTMLElement;
  private token = 0;

  constructor() {
    this.overlay = byId('wiki');
    this.content = byId('wiki-content');
    byId('wiki-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.hidden) this.hide();
    });
  }

  hide(): void {
    this.overlay.hidden = true;
    this.token++; // cancel any in-flight render
  }

  async show(title: string): Promise<void> {
    const id = ++this.token;
    const pretty = title.replace(/_/g, ' ');
    const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    this.content.innerHTML = `<div class="wiki__loading">Loading “${escapeHtml(pretty)}” …</div>`;
    this.overlay.hidden = false;

    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        title?: string;
        extract?: string;
        thumbnail?: { source?: string };
        content_urls?: { desktop?: { page?: string } };
      };
      if (id !== this.token) return; // superseded or closed

      const page = j.content_urls?.desktop?.page ?? articleUrl;
      const img = j.thumbnail?.source
        ? `<img class="wiki__img" src="${escapeAttr(j.thumbnail.source)}" alt="" />`
        : '';
      this.content.innerHTML =
        `<h3 class="wiki__title">${escapeHtml(j.title ?? pretty)}</h3>` +
        img +
        `<p class="wiki__extract">${escapeHtml(j.extract ?? 'No summary available.')}</p>` +
        `<a class="wiki__link" href="${escapeAttr(page)}" target="_blank" rel="noopener noreferrer">Read the full article on Wikipedia ↗</a>`;
    } catch (err) {
      if (id !== this.token) return;
      this.content.innerHTML =
        `<h3 class="wiki__title">${escapeHtml(pretty)}</h3>` +
        `<p class="wiki__extract">Couldn’t load the summary (${escapeHtml(String(err))}).</p>` +
        `<a class="wiki__link" href="${escapeAttr(articleUrl)}" target="_blank" rel="noopener noreferrer">Open on Wikipedia ↗</a>`;
    }
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function escapeAttr(s: string): string {
  return s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!);
}
