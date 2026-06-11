import type { Star } from './types';
import {
  parsecsToLightYears,
  spectralClassFromBpRp,
  tempFromBpRp,
} from './transform';

/**
 * Bottom-right specs panel shown when a star (or the Sun) is selected by
 * clicking. Renders derived spectral/temperature/proper-motion details and
 * tracks the unit (pc/ly) toggle.
 */
export class DetailsPanel {
  private readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private useLightYears = false;
  private current: Star | 'sun' | null = null;

  constructor(private readonly onClose: () => void) {
    this.el = byId('details');
    this.titleEl = byId('details-title');
    this.bodyEl = byId('details-body');
    byId('details-close').addEventListener('click', () => {
      this.hide();
      this.onClose();
    });
  }

  setUnits(useLightYears: boolean): void {
    this.useLightYears = useLightYears;
    if (this.current && this.current !== 'sun') this.showStar(this.current);
    else if (this.current === 'sun') this.showSun();
  }

  hide(): void {
    this.current = null;
    this.el.hidden = true;
  }

  showSun(): void {
    this.current = 'sun';
    this.titleEl.textContent = 'The Sun';
    this.bodyEl.innerHTML = rows([
      ['Type', 'G2V main-sequence star'],
      ['Distance', '0 — you are here'],
      ['Apparent mag (G)', '≈ −26.7 (from Earth)'],
      ['Surface temp', '≈ 5,772 K'],
      ['Spectral colour', swatch('#fff2c4') + 'yellow-white'],
      ['Age', '≈ 4.6 billion years'],
    ]);
    this.el.hidden = false;
  }

  showStar(star: Star): void {
    this.current = star;
    this.titleEl.textContent = star.name ?? 'Unnamed star';

    const ly = parsecsToLightYears(star.distancePc);
    const dist = this.useLightYears
      ? `${ly.toFixed(2)} ly (${star.distancePc.toFixed(2)} pc)`
      : `${star.distancePc.toFixed(2)} pc (${ly.toFixed(2)} ly)`;

    const temp = tempFromBpRp(star.bpRp);
    const cls = spectralClassFromBpRp(star.bpRp);
    const totalPm = Math.hypot(star.pmra, star.pmdec);

    const data: [string, string][] = [
      ['Spectral class', cls === '—' ? 'unknown' : `${cls}-type`],
      ['Distance', dist],
      ['Apparent mag (G)', Number.isFinite(star.mag) ? star.mag.toFixed(2) : '—'],
      ['Est. temperature', temp ? `≈ ${temp.toLocaleString('en-US')} K` : '—'],
      ['Colour index (BP−RP)', star.bpRp == null ? '—' : star.bpRp.toFixed(2)],
      ['Proper motion', `${totalPm.toFixed(0)} mas/yr total`],
      ['  ↳ in RA / Dec', `${star.pmra.toFixed(0)} / ${star.pmdec.toFixed(0)} mas/yr`],
      ['Sky position (RA, Dec)', `${star.ra.toFixed(2)}°, ${star.dec.toFixed(2)}°`],
    ];
    this.bodyEl.innerHTML = rows(data);
    this.el.hidden = false;
  }
}

function rows(items: [string, string][]): string {
  return items
    .map(
      ([k, v]) =>
        `<div class="spec"><span class="spec__k">${escapeHtml(k)}</span><span class="spec__v">${v}</span></div>`,
    )
    .join('');
}

function swatch(css: string): string {
  return `<span class="spec__swatch" style="background:${css}"></span>`;
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
