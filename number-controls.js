/* Progressive number controls. Keep native inputs, validation and form payloads. */
(() => {
  'use strict';
  const source = document.currentScript;
  const assetBase = new URL('.', source && source.src ? source.src : document.baseURI);
  const selector = 'input[type="number"]:not([data-native-number])';
  let nextId = 0;

  function enhance(input) {
    if (input.closest('.ss-number-stepper, .honeypot, [aria-hidden="true"]') || input.step === 'any') return;
    if (!input.id) {
      let id;
      do { nextId += 1; id = 'ss-number-' + nextId; }
      while (document.getElementById(id));
      input.id = id;
    }
    const label = input.labels && input.labels[0];
    const labelCopy = label && label.cloneNode(true);
    if (labelCopy) labelCopy.querySelectorAll('input, small, select, textarea, button').forEach(el => el.remove());
    const name = (input.getAttribute('aria-label') || (labelCopy && labelCopy.textContent) || input.name || 'number').trim().replace(/\s+/g, ' ');
    const group = document.createElement('span');
    group.className = 'ss-number-stepper';
    const buttons = [-1, 1].map(direction => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ss-number-button';
      button.dataset.direction = String(direction);
      button.setAttribute('aria-label', (direction < 0 ? 'Decrease ' : 'Increase ') + name.toLowerCase());
      button.setAttribute('aria-controls', input.id);
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = direction < 0 ? '\u2212' : '+';
      button.append(icon);
      return button;
    });
    // Buttons must be outside the label: a label must not contain several controls.
    const wrappingLabel = input.closest('label');
    if (wrappingLabel && wrappingLabel.querySelectorAll('input, select, textarea, button').length === 1) {
      const field = document.createElement('div');
      field.className = 'ss-number-field';
      wrappingLabel.before(field);
      field.append(wrappingLabel, group);
      wrappingLabel.htmlFor = input.id;
      const notes = [...wrappingLabel.querySelectorAll('small')];
      group.append(buttons[0], input, buttons[1]);
      notes.forEach(note => field.append(note));
    } else if (!wrappingLabel) {
      input.before(group);
      group.append(buttons[0], input, buttons[1]);
    } else {
      return; // Leave unfamiliar multi-control labels usable rather than rewriting them.
    }
    input.classList.add('ss-number-input');
    input.closest('.quick-player-row')?.classList.add('ss-number-row');
    const blocked = () => input.matches(':disabled') || input.readOnly;
    const bound = (attribute, fallback) => input.getAttribute(attribute)?.trim() ? Number(input.getAttribute(attribute)) : fallback;
    function sync() {
      const value = input.valueAsNumber;
      buttons[0].disabled = blocked() || (Number.isFinite(value) && value <= bound('min', -Infinity));
      buttons[1].disabled = blocked() || (Number.isFinite(value) && value >= bound('max', Infinity));
      group.classList.toggle('is-disabled', blocked());
    }
    function step(direction) {
      if (blocked()) return;
      const before = input.value;
      try {
        // Start an explicitly clicked empty field at its minimum, not an invalid zero.
        if (input.value === '' && Number.isFinite(bound('min', NaN))) input.value = input.min;
        else if (direction > 0) input.stepUp();
        else input.stepDown();
      } catch { return; }
      if (input.value !== before) {
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
      }
      sync();
    }
    buttons.forEach((button, index) => button.addEventListener('click', () => step(index ? 1 : -1)));
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    input.addEventListener('focus', sync);
    input.form?.addEventListener('reset', () => setTimeout(sync, 0));
    const observer = new MutationObserver(sync);
    observer.observe(input, {attributes: true, attributeFilter: ['min', 'max', 'step', 'disabled', 'readonly', 'value']});
    for (let parent = input.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'FIELDSET') observer.observe(parent, {attributes: true, attributeFilter: ['disabled']});
    }
    sync();
  }

  function init() {
    const inputs = [...document.querySelectorAll(selector)];
    if (!inputs.length) return;
    // Only enhance after styles load; failed CSS leaves the native spinner intact.
    let stylesheet = document.getElementById('ss-number-controls-css');
    const apply = () => inputs.forEach(enhance);
    if (stylesheet) {
      if (stylesheet.sheet) apply();
      else stylesheet.addEventListener('load', apply, {once: true});
      return;
    }
    stylesheet = document.createElement('link');
    stylesheet.id = 'ss-number-controls-css';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('number-controls.css?v=20261027', assetBase).href;
    stylesheet.addEventListener('load', apply, {once: true});
    document.head.append(stylesheet);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
