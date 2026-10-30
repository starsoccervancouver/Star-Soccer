/* Explicit, browser-native dictation. No recording upload, storage or automatic save. */
(() => {
  'use strict';
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const controls = new Map();
  let active = null;
  let inserting = false;
  const app = () => document.getElementById('app');
  const key = field => [document.getElementById('session')?.value, field.closest('.tab-panel')?.id,
    field.id === 'note-body' ? document.getElementById('note-player')?.value : field.id === 'planner-note-body' ? document.getElementById('planner-notes-player')?.value : '', field.id].join('|');
  const editable = field => !app()?.hidden && !field.disabled && !field.readOnly &&
    !field.closest('[hidden]') && !field.closest('#planner-drawer')?.hidden && !field.closest('#planner-notes-pane')?.hidden && document.getElementById('desk-main')?.getAttribute('aria-busy') !== 'true';

  function status(control, text) {
    control.status.textContent = text;
    control.status.hidden = !text;
  }
  function refresh() {
    for (const control of controls.values()) {
      const listening = active?.control === control;
      control.button.textContent = listening ? 'Stop dictation' : control.label;
      control.button.setAttribute('aria-pressed', String(listening));
      control.button.disabled = !Recognition || !editable(control.field);
      control.button.classList.toggle('is-listening', listening);
    }
  }
  function cancel(text = 'Dictation stopped. Your text is kept.') {
    if (!active) return;
    const run = active;
    active = null; // Invalidate callbacks before abort(), which may emit events synchronously.
    try { run.recognition.abort(); } catch { /* Already ended. */ }
    status(run.control, text);
    refresh();
  }
  function valid(run) {
    return active === run && editable(run.control.field) && key(run.control.field) === run.key;
  }
  function insert(run, transcript) {
    const field = run.control.field;
    const phrase = String(transcript || '').trim();
    if (!phrase) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const before = field.value.slice(0, start), after = field.value.slice(end);
    const leading = before && !/[\s([{]$/.test(before) && !/^[,.;:!?)]/.test(phrase) ? ' ' : '';
    const trailing = after && !/^[\s,.;:!?)]/.test(after) ? ' ' : '';
    const limit = field.maxLength >= 0 ? field.maxLength : Infinity;
    const room = Math.max(0, limit - before.length - after.length - leading.length - trailing.length);
    if (!room) { cancel('This field has reached its character limit. Review the text before continuing.'); return; }
    const accepted = phrase.slice(0, room);
    field.value = before + leading + accepted + trailing + after;
    const cursor = before.length + leading.length + accepted.length;
    field.setSelectionRange(cursor, cursor);
    inserting = true;
    try { field.dispatchEvent(new Event('input', { bubbles: true })); }
    finally { inserting = false; }
    if (accepted.length < phrase.length) cancel('This field has reached its character limit. Review the text before continuing.');
  }
  function start(control) {
    if (!Recognition || !editable(control.field)) return;
    if (active?.control === control) {
      status(control, 'Finishing dictation…');
      try { active.recognition.stop(); } catch { cancel(); }
      return;
    }
    cancel();
    let recognition;
    try { recognition = new Recognition(); }
    catch { status(control, 'Dictation could not start. You can still use your device’s voice typing.'); return; }
    const run = { recognition, control, key: key(control.field), final: new Set(), error: false };
    active = run;
    recognition.lang = 'en-CA';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    status(control, 'Starting microphone…');
    refresh();
    recognition.onstart = () => {
      if (!valid(run)) { if (active === run) cancel(); return; }
      status(control, 'Listening. Speak naturally, then choose Stop dictation.');
    };
    recognition.onresult = event => {
      if (!valid(run)) { if (active === run) cancel(); return; }
      const results = event.results || [];
      const interim = [];
      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (!result) continue;
        if (result.isFinal) {
          if (index < (event.resultIndex || 0) || run.final.has(index)) continue;
          run.final.add(index);
          insert(run, result[0]?.transcript);
          if (active !== run) return;
        } else if (result[0]?.transcript) interim.push(result[0].transcript);
      }
      status(control, interim.length ? 'Hearing: ' + interim.join(' ') : 'Listening. Review and edit the text before saving.');
    };
    recognition.onerror = event => {
      if (active !== run) return;
      const messages = {
        'not-allowed': 'Microphone permission was not granted. Allow it in your browser or use device voice typing.',
        'service-not-allowed': 'This browser has disabled its speech service. You can use device voice typing instead.',
        'audio-capture': 'No microphone is available. Check your microphone or use device voice typing.',
        'no-speech': 'No speech was detected. Try again when you are ready.',
        network: 'The browser’s speech service is unavailable. You can keep typing or try again.',
      };
      run.error = true;
      cancel(messages[event.error] || 'Dictation stopped. You can keep typing or try again.');
    };
    recognition.onend = () => {
      if (active !== run) return;
      active = null;
      if (!run.error) status(control, 'Dictation stopped. Review your text before saving.');
      refresh();
    };
    try { recognition.start(); }
    catch { cancel('Dictation could not start. Check microphone permission or use device voice typing.'); }
  }

  for (const field of document.querySelectorAll('textarea[data-dictation-label]')) {
    const label = field.dataset.dictationLabel;
    const tools = document.createElement('div'); tools.className = 'dictation-tools';
    const button = document.createElement('button'); button.type = 'button';
    button.id = 'dictation-' + field.id; button.className = 'secondary dictation-button';
    button.setAttribute('aria-controls', field.id); button.setAttribute('aria-pressed', 'false');
    const message = document.createElement('p'); message.className = 'dictation-status';
    message.id = 'dictation-status-' + field.id; message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite'); message.hidden = true;
    tools.append(button, message);
    const fieldLabel = field.closest('label');
    if (fieldLabel) {
      const wrapper = document.createElement('div'); wrapper.className = 'dictation-field';
      if (fieldLabel.classList.contains('full-width')) wrapper.classList.add('full-width');
      fieldLabel.before(wrapper); wrapper.append(fieldLabel, tools);
    } else field.after(tools);
    const control = { field, button, status: message, label };
    controls.set(field.id, control);
    button.addEventListener('click', () => start(control));
    field.addEventListener('input', () => {
      if (!inserting && active?.control === control) cancel('Dictation stopped while you edited. Your text is kept.');
    });
  }
  for (const help of document.querySelectorAll('.dictation-help')) {
    help.textContent = Recognition
      ? 'Your browser’s speech provider may process audio. Review the text before saving.'
      : 'Browser dictation is unavailable here. You can use your device’s voice typing.';
  }
  document.addEventListener('coach:dictation-stop', () => cancel());
  document.addEventListener('coach:dictation-state', () => { if (active && !valid(active)) cancel(); refresh(); });
  window.addEventListener('coach:context', () => {
    if (active && !valid(active)) cancel();
    refresh();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  window.addEventListener('pagehide', () => cancel());
  refresh();
  window.dispatchEvent(new Event('coach:request-context'));
})();
