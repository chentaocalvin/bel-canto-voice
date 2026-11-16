let active = null;
let closeTimer = 0;

function close() {
  clearTimeout(closeTimer);
  if (!active) return;
  active.tip.hidden = true;
  active.button.setAttribute('aria-expanded', 'false');
  active = null;
}

function position() {
  if (!active) return;
  const { button, tip } = active;
  const rect = button.getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const left = Math.max(
    12,
    Math.min(window.innerWidth - width - 12, rect.x + rect.width / 2 - width / 2),
  );
  const top =
    rect.bottom + height + 8 <= window.innerHeight - 12
      ? rect.bottom + 8
      : Math.max(12, rect.top - height - 8);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

document.addEventListener(
  'pointerdown',
  (event) => {
    if (active && !active.button.contains(event.target) && !active.tip.contains(event.target))
      close();
  },
  true,
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
});
window.addEventListener('resize', position);
document.addEventListener('scroll', position, true);

export function createControlHelp(id, label, description, control, accessibleName = label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control-help';
  button.setAttribute('aria-label', 'About ' + accessibleName);
  button.setAttribute('aria-expanded', 'false');
  const name = document.createElement('span');
  name.className = 'knob-name';
  name.textContent = label;
  const icon = document.createElement('span');
  icon.className = 'help-icon';
  icon.textContent = '?';
  icon.setAttribute('aria-hidden', 'true');
  button.append(name, icon);
  const tip = document.createElement('div');
  tip.id = 'control-help-' + id;
  tip.className = 'control-help-text';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = description;
  tip.hidden = true;
  button.setAttribute('aria-controls', tip.id);
  button.setAttribute('aria-describedby', tip.id);
  control.setAttribute('aria-describedby', tip.id);
  document.body.appendChild(tip);
  const show = () => {
    clearTimeout(closeTimer);
    if (active?.button === button) return;
    close();
    active = { button, tip, pinned: false };
    tip.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    position();
  };
  const leave = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (active?.button === button && !active.pinned && document.activeElement !== button) close();
    }, 160);
  };
  button.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') show();
  });
  button.addEventListener('pointerleave', leave);
  tip.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  tip.addEventListener('pointerleave', leave);
  button.addEventListener('focus', show);
  button.addEventListener('blur', () => {
    if (active?.button === button) close();
  });
  button.addEventListener('click', () => {
    if (active?.button === button && active.pinned) close();
    else {
      show();
      active.pinned = true;
    }
  });
  button.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.key === 'Enter') event.stopPropagation();
  });
  return button;
}
