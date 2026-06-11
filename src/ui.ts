import type { FilterMode } from './stars';

export interface UiCallbacks {
  onTimeChange(years: number): void;
  onUnitsChange(useLightYears: boolean): void;
  onFilterChange(mode: FilterMode): void;
}

const PLAY_RATE = 4000; // years advanced per real second while playing
const MIN_YEAR = -100000;
const MAX_YEAR = 100000;

/**
 * Owns the corner control panel: time slider, play/pause (ping-pong),
 * reset/now buttons, unit toggle, status chip, and the boot overlay.
 *
 * `tick(dt)` is called once per animation frame by the main render loop so
 * playback shares a single rAF rather than spinning up its own.
 */
export class Ui {
  private readonly slider: HTMLInputElement;
  private readonly yearLabel: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly featuresToggle: HTMLButtonElement;
  private readonly featuresPanel: HTMLElement;
  private readonly filterSeg: HTMLElement;
  private readonly unitsSeg: HTMLElement;
  private readonly loading: HTMLElement;

  private year = 0;
  private playing = false;
  private playDir = 1;

  constructor(private readonly cb: UiCallbacks) {
    this.slider = byId<HTMLInputElement>('time');
    this.yearLabel = byId('year');
    this.playBtn = byId<HTMLButtonElement>('play');
    this.featuresToggle = byId<HTMLButtonElement>('features-toggle');
    this.featuresPanel = byId('features');
    this.filterSeg = byId('filter-seg');
    this.unitsSeg = byId('units-seg');
    this.loading = byId('loading');

    this.slider.addEventListener('input', () => {
      this.stop();
      this.setYear(Number(this.slider.value), true);
    });

    this.playBtn.addEventListener('click', () => this.togglePlay());
    // Collapsible "Filters & features" section.
    this.featuresToggle.addEventListener('click', () => {
      const open = this.featuresPanel.hidden;
      this.featuresPanel.hidden = !open;
      this.featuresToggle.setAttribute('aria-expanded', String(open));
      this.featuresToggle.classList.toggle('is-active', open);
    });

    // Named/unnamed filter (segmented).
    this.filterSeg.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]');
      if (!btn) return;
      this.setSegActive(this.filterSeg, btn);
      this.cb.onFilterChange(btn.dataset.filter as FilterMode);
    });

    // Distance units (segmented).
    this.unitsSeg.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-units]');
      if (!btn) return;
      this.setSegActive(this.unitsSeg, btn);
      this.cb.onUnitsChange(btn.dataset.units === 'ly');
    });

    this.renderYear();
  }

  private setSegActive(seg: HTMLElement, active: HTMLElement): void {
    seg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b === active));
  }

  /** Advance playback. dt is seconds since the previous frame. */
  tick(dt: number): void {
    if (!this.playing) return;
    let next = this.year + this.playDir * PLAY_RATE * dt;
    if (next >= MAX_YEAR) {
      next = MAX_YEAR;
      this.playDir = -1;
    } else if (next <= MIN_YEAR) {
      next = MIN_YEAR;
      this.playDir = 1;
    }
    this.setYear(next, true);
  }

  setYear(years: number, emit: boolean): void {
    this.year = clamp(years, MIN_YEAR, MAX_YEAR);
    this.slider.value = String(Math.round(this.year));
    this.renderYear();
    if (emit) this.cb.onTimeChange(this.year);
  }

  togglePlay(): void {
    this.playing ? this.stop() : this.start();
  }

  private start(): void {
    this.playing = true;
    this.playBtn.textContent = '❚❚';
    this.playBtn.setAttribute('aria-label', 'Pause');
    this.playBtn.classList.add('is-playing');
  }

  private stop(): void {
    this.playing = false;
    this.playBtn.textContent = '▶';
    this.playBtn.setAttribute('aria-label', 'Play');
    this.playBtn.classList.remove('is-playing');
  }

  /** Reflect the unit choice on the segmented control (no event fired). */
  syncUnits(useLightYears: boolean): void {
    const sel = this.unitsSeg.querySelector<HTMLElement>(`[data-units="${useLightYears ? 'ly' : 'pc'}"]`);
    if (sel) this.setSegActive(this.unitsSeg, sel);
  }

  hideLoading(): void {
    this.loading.classList.add('loading--hidden');
    window.setTimeout(() => {
      this.loading.hidden = true;
    }, 600);
  }

  private renderYear(): void {
    const y = Math.round(this.year);
    const sign = y > 0 ? '+' : '';
    this.yearLabel.textContent = `${sign}${y.toLocaleString('en-US')}`;
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the DOM`);
  return el as T;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
