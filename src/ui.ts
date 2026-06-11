import type { DataSource } from './types';

export interface UiCallbacks {
  onTimeChange(years: number): void;
  onReset(): void;
  onUnitsChange(useLightYears: boolean): void;
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
  private readonly resetBtn: HTMLButtonElement;
  private readonly nowBtn: HTMLButtonElement;
  private readonly unitsToggle: HTMLInputElement;
  private readonly chip: HTMLElement;
  private readonly loading: HTMLElement;

  private year = 0;
  private playing = false;
  private playDir = 1;

  constructor(private readonly cb: UiCallbacks) {
    this.slider = byId<HTMLInputElement>('time');
    this.yearLabel = byId('year');
    this.playBtn = byId<HTMLButtonElement>('play');
    this.resetBtn = byId<HTMLButtonElement>('reset');
    this.nowBtn = byId<HTMLButtonElement>('now');
    this.unitsToggle = byId<HTMLInputElement>('units');
    this.chip = byId('status-chip');
    this.loading = byId('loading');

    this.slider.addEventListener('input', () => {
      this.stop();
      this.setYear(Number(this.slider.value), true);
    });

    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.resetBtn.addEventListener('click', () => this.cb.onReset());
    this.nowBtn.addEventListener('click', () => {
      this.stop();
      this.setYear(0, true);
    });
    this.unitsToggle.addEventListener('change', () =>
      this.cb.onUnitsChange(this.unitsToggle.checked),
    );

    this.renderYear();
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

  setStatus(source: DataSource): void {
    if (source === 'live') {
      this.chip.textContent = 'Live Gaia data';
      this.chip.className = 'chip chip--live';
    } else {
      this.chip.textContent = 'Offline sample data';
      this.chip.className = 'chip chip--offline';
    }
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
