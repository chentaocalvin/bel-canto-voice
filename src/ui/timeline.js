export function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function paintWaveform(canvas, peaks, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!peaks) return;
  const mid = h / 2;
  const amp = Math.max(1, mid - 3);
  g.strokeStyle = 'rgba(227, 181, 107, 0.55)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < peaks.columns; x++) {
    const top = mid - peaks.max[x] * amp;
    const bottom = mid - peaks.min[x] * amp;
    g.moveTo(x + 0.5, top);
    g.lineTo(x + 0.5, Math.max(bottom, top + 0.8));
  }
  g.stroke();
  g.strokeStyle = 'rgba(227, 181, 107, 0.14)';
  g.beginPath();
  g.moveTo(0, mid + 0.5);
  g.lineTo(w, mid + 0.5);
  g.stroke();
}
