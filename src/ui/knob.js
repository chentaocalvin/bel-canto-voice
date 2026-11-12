const CX = 40;
const CY = 40;
const R = 30;
const START = -135;
const SWEEP = 270;

function polar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [CX + Math.sin(rad) * r, CY - Math.cos(rad) * r];
}

function arcPath(r, f0, f1) {
  if (Math.abs(f1 - f0) < 0.0005) return '';
  const a0 = START + SWEEP * f0;
  const a1 = START + SWEEP * f1;
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function tickMarks(count = 9) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = START + (SWEEP * i) / (count - 1);
    const [x1, y1] = polar(35, a);
    const [x2, y2] = polar(i % 4 === 0 ? 38 : 37, a);
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />`,
    );
  }
  return parts.join('');
}

export class Knob {
  constructor(id, def, value, onChange) {
    this.id = id;
    this.def = def;
    this.onChange = onChange;
    this.value = value;
    this.dragging = false;

    const el = document.createElement('div');
    el.className = 'knob';
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.innerHTML = `
      <span class="knob-name">${def.label}</span>
      <div class="knob-dial">
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <g class="knob-ticks">${tickMarks()}</g>
          <path class="knob-track" d="${arcPath(R, 0, 1)}" />
          <path class="knob-arc" d="" />
          <circle class="knob-cap" cx="${CX}" cy="${CY}" r="22.5" />
          <circle class="knob-cap-ring" cx="${CX}" cy="${CY}" r="22.5" />
          <ellipse class="knob-gloss" cx="32.5" cy="29" rx="13" ry="8" transform="rotate(-18 32.5 29)" />
          <line class="knob-tick" x1="0" y1="0" x2="0" y2="0" />
        </svg>
      </div>
      <span class="knob-value"></span>
      <span class="knob-bubble"></span>
    `;
    this.el = el;
    this.arc = el.querySelector('.knob-arc');
    this.tick = el.querySelector('.knob-tick');
    this.valueEl = el.querySelector('.knob-value');
    this.bubbleEl = el.querySelector('.knob-bubble');

    this._bindPointer();
    this._bindKeyboard();
    this.el.setAttribute('aria-label', this.def.label);
    this.setValue(value, true);
  }

  _frac(v) {
    return clamp((v - this.def.min) / (this.def.max - this.def.min), 0, 1);
  }

  _quantize(v) {
    const step = this.def.step;
    const q = Math.round((v - this.def.min) / step) * step + this.def.min;
    return clamp(parseFloat(q.toFixed(4)), this.def.min, this.def.max);
  }

  setValue(v, silent = false) {
    const next = this._quantize(v);
    if (next === this.value && !silent) return;
    this.value = next;
    this._render();
    if (!silent) this.onChange(this.id, next);
  }

  _render() {
    const f = this._frac(this.value);

    const f0 = this.def.bipolar ? this._frac(0) : 0;
    this.arc.setAttribute(
      'd',
      Math.abs(f - f0) > 0.001 ? arcPath(R, Math.min(f, f0), Math.max(f, f0)) : '',
    );
    const a = START + SWEEP * f;
    const [x1, y1] = polar(10, a);
    const [x2, y2] = polar(21, a);
    this.tick.setAttribute('x1', x1.toFixed(2));
    this.tick.setAttribute('y1', y1.toFixed(2));
    this.tick.setAttribute('x2', x2.toFixed(2));
    this.tick.setAttribute('y2', y2.toFixed(2));
    this.valueEl.textContent = this.def.format(this.value);
    if (this.bubbleEl) this.bubbleEl.textContent = this.def.format(this.value);
    this.el.setAttribute('aria-valuemin', String(this.def.min));
    this.el.setAttribute('aria-valuemax', String(this.def.max));
    this.el.setAttribute('aria-valuenow', String(this.value));
    this.el.setAttribute('aria-valuetext', this.def.format(this.value));
  }

  _bindPointer() {
    const el = this.el;
    const down = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.dragging = true;
      this.startY = e.clientY;
      this.startX = e.clientX;
      this.startVal = this.value;
      this.moved = false;
      el.classList.add('is-active');
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.dragging) return;
      const dy = this.startY - e.clientY;
      const dx = e.clientX - this.startX;
      if (Math.abs(dy) + Math.abs(dx) > 2) this.moved = true;
      const range = this.def.max - this.def.min;
      const fine = e.shiftKey ? 0.2 : 1;
      const next = this.startVal + (dy / 170) * range * fine;
      this.setValue(next);
      if (this.moved) e.preventDefault();
    };
    const up = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('is-active');
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.setValue(this.def.def);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dir = e.deltaY > 0 ? -1 : 1;
        const mult = e.shiftKey ? 1 : 4;
        this.setValue(this.value + dir * this.def.step * mult);
      },
      { passive: false },
    );
  }

  _bindKeyboard() {
    this.el.addEventListener('keydown', (e) => {
      const step = this.def.step * (e.shiftKey ? 1 : 5);
      let handled = true;
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          this.setValue(this.value + step);
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          this.setValue(this.value - step);
          break;
        case 'PageUp':
          this.setValue(this.value + step * 10);
          break;
        case 'PageDown':
          this.setValue(this.value - step * 10);
          break;
        case 'Home':
          this.setValue(this.def.min);
          break;
        case 'End':
          this.setValue(this.def.max);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    });
  }
}
