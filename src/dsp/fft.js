export class FFT {
  constructor(size) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error('FFT size must be a power of two');
    }
    this.size = size;
    this.levels = Math.log2(size);
    this.cos = new Float64Array(size >> 1);
    this.sin = new Float64Array(size >> 1);
    for (let i = 0; i < size >> 1; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < this.levels; b++) {
        r |= ((i >>> b) & 1) << (this.levels - 1 - b);
      }
      this.rev[i] = r;
    }
  }

  transform(re, im) {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = this.cos[k];
          const s = this.sin[k];
          const jh = j + half;
          const tr = re[jh] * c + im[jh] * s;
          const ti = im[jh] * c - re[jh] * s;
          re[jh] = re[j] - tr;
          im[jh] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }
  }

  inverse(re, im) {
    const n = this.size;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.transform(re, im);
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] = -im[i] * s;
    }
  }
}
