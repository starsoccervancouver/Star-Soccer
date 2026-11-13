/* One-day camp intake. A submitted request is reviewed before a place is confirmed. */
(function () {
  'use strict';
  const form = document.querySelector('[data-day-camp]');
  if (!form) return;
  const submit = form.querySelector('[type="submit"]');
  const receipt = document.getElementById('day-camp-receipt');
  const startsAt = Date.parse('2026-11-20T12:00:00-08:00');
  let state = 'ready', reference = '', retryAt = 0;
  const field = name => form.elements.namedItem(name);
  function message(title, text) {
    receipt.replaceChildren();
    const heading = document.createElement('h2'), paragraph = document.createElement('p');
    heading.textContent = title; paragraph.textContent = text;
    receipt.append(heading, paragraph); receipt.hidden = false;
  }
  function isOpen() {
    if (Date.now() < startsAt) return true;
    submit.disabled = true; submit.textContent = 'Registration closed';
    message('Registration is closed', 'This camp ran on November 20, 2026. Explore our weekly training or email starsoccervancouver@gmail.com for upcoming camps.');
    return false;
  }
  function lock(value) {
    [...form.elements].forEach(control => { control.disabled = value; });
  }
  if (!window.StarFormService || !window.StarFamilyRegistration || !window.StarFormRecovery) return;
  if (isOpen()) submit.disabled = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state !== 'ready' || Date.now() < retryAt || !isOpen()) return;
    const name = field('Player name').value.trim();
    field('Player name').setCustomValidity(!name || /[\r\n\x00-\x1f]/.test(name) ? 'Enter the player’s full name.' : '');
    if (!form.reportValidity() || field('_honey').value) return;
    const age = Number(field('Player age').value);
    if (!Number.isInteger(age) || age < 6 || age > 14) return;
    const email = field('email').value.trim();
    const data = new FormData(form);
    reference ||= StarFamilyRegistration.reference('SS-DAY-');
    const facts = {
      'Player name': name, email, 'Intake version': 'SS-DAY-CAMP-V1',
      'Registration reference': reference, 'Camp ID': 'pro-d-2026-11-20',
      'Camp': 'November 20 Pro-D Day Camp', 'Registration type': 'Single-day drop-in',
      'Session date': '2026-11-20', 'Start time': '12:00', 'End time': '15:00',
      'Time zone': 'America/Vancouver', 'Location': 'Kitsilano Turf',
      'Price CAD': '60', 'Number of players': '1', 'Total CAD': '60', 'Capacity': '20',
      'Status': 'Registration request — coaching team must confirm space',
      '_subject': 'Star Soccer Pro-D camp registration — ' + name,
      '_url': 'https://starsoccer.ca/pro-d-camp-registration.html'
    };
    Object.entries(facts).forEach(([key, value]) => data.set(key, value));
    window.StarCampaignSource?.append(data);
    state = 'sending'; lock(true); submit.textContent = 'Sending…'; receipt.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const { response, body } = await StarFormService.submit(form, data, { signal: controller.signal });
      if (response.ok && body.success === true) {
        state = 'accepted'; submit.textContent = 'Request received'; form.hidden = true;
        message('Thanks — your registration request is received.', name + ' · Friday, November 20 · 12–3 PM · Kitsilano Turf · Total: $60 CAD. We’ll check space and email your confirmation to ' + email + '. A place is confirmed by the coaching team.');
        window.StarFunnel?.track('submission_accepted', { program: 'camp', kind: 'dropin' });
      } else if (StarFamilyRegistration.rejected(response, body)) {
        state = 'ready'; lock(false); retryAt = StarFamilyRegistration.retryAfter(response);
        message('Your request was not submitted', retryAt ? 'Please wait before trying again, or send these details to our team.' : 'Please try again, or send these details to our team.');
        submit.textContent = 'Register for camp · $60';
        if (retryAt) { submit.disabled = true; setTimeout(() => { if (state === 'ready' && isOpen()) submit.disabled = false; }, Math.min(retryAt - Date.now() + 50, 2147483647)); }
        StarFormRecovery.show(receipt, { email: 'starsoccervancouver@gmail.com', subject: 'Pro-D camp registration help', requests: [data], states: [{ name, state: 'rejected', reference }], reference });
      } else throw new Error('Uncertain delivery');
    } catch {
      state = 'uncertain'; submit.textContent = 'Please contact our team';
      message('We couldn’t confirm receipt', 'Your request may have reached us. Please send the details below to our team so we can check it.');
      StarFormRecovery.show(receipt, { email: 'starsoccervancouver@gmail.com', subject: 'Please check my Pro-D camp registration', requests: [data], states: [{ name, state: 'unconfirmed', reference }], reference });
    } finally {
      clearTimeout(timeout); receipt.focus();
    }
  });
  field('Player name').addEventListener('input', () => field('Player name').setCustomValidity(''));
})();
