'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { data: null, busy: false, connecting: false, pilotReady: false, pilotWallet: null };
  // These server errors are raised before any tunnel/allowance change is committed.
  // Every other failure retains the original request ID until its outcome is known.
  const noCommitCodes = new Set(['INVALID_PLAN', 'REQUEST_ID_REQUIRED', 'ALLOWANCE_EXHAUSTED', 'TUNNEL_NOT_FOUND']);
  const sampleDays = (cents, dayPrice) => Number.isSafeInteger(cents) && Number.isSafeInteger(dayPrice) && dayPrice > 0 ? Math.floor(cents / dayPrice) : null;
  const daysLabel = (count) => `${count} ${count === 1 ? 'day' : 'days'}`;
  const date = (value, includeTime = false) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Not available' : parsed.toLocaleString(undefined, {
      month: 'short', day: 'numeric', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    });
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (name) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('class', 'icon');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/icons.svg#${name}`);
    node.append(use);
    return node;
  };
  const message = (text, error = false) => {
    const feedback = $('feedback');
    feedback.textContent = text;
    feedback.classList.toggle('error', error);
    feedback.hidden = !text;
  };
  const pendingKey = () => `vpn:pending:v1:${state.data?.session?.kind}:${state.data?.session?.address || 'demo'}`;
  function pendingRequests() {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingKey()) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  function rememberRequest(key, value) {
    const pending = pendingRequests();
    if (value) pending[key] = value;
    else delete pending[key];
    try {
      sessionStorage.setItem(pendingKey(), JSON.stringify(pending));
    } catch {
      throw new Error('This browser cannot save request recovery details. Enable session storage before creating a tunnel. No new request was sent.');
    }
  }
  async function api(path, body) {
    let response;
    try {
      response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('The server did not respond. Any pending tunnel request has been saved; retry it to check the same request.');
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(result?.error || `The request could not be completed (${response.status}).`);
      error.status = response.status;
      error.code = result?.code;
      throw error;
    }
    if (!result) throw new Error('The server returned an unreadable response. Retry the saved request before starting another.');
    return result;
  }
  async function refresh() {
    const result = await api('/api/bootstrap');
    state.data = result;
    render();
  }
  function setBusy(value) {
    state.busy = value;
    $('demo-button').disabled = value;
    $('wallet-button').disabled = value;
    $('logout-button').disabled = value;
    $('pilot-check').disabled = value;
    $('pilot-download').disabled = value || !state.pilotReady;
    renderCreate();
    document.querySelectorAll('[data-renew]').forEach((button) => { button.disabled = value || state.data?.session?.kind !== 'demo'; });
  }
  function renderCreate() {
    const data = state.data;
    const demo = data?.session?.kind === 'demo';
    const eligible = data?.dashboard?.eligibility?.eligible === true;
    const pending = data?.session ? pendingRequests().create : null;
    const plan = data?.catalogue?.plans?.find((item) => item.id === 'day');
    const allowance = data?.dashboard?.allowance;
    const affordable = allowance && plan && allowance.remainingCents >= plan.priceCents;
    if (pending?.body) {
      $('tunnel-name').value = pending.body.name;
      $('country').value = pending.body.country;
    }
    $('tunnel-name').disabled = state.busy || !!pending;
    $('country').disabled = state.busy || !!pending;
    $('create-button').disabled = state.busy || !demo || (!pending && (!eligible || !affordable || !plan));
    let label = state.busy ? 'Working…' : 'Create sample plan';
    let caption = 'No payment. This creates a sample file, not a VPN connection.';
    if (!data?.session) label = data?.mode === 'demo' ? 'Start the demo above' : 'Live provisioning is not available';
    else if (!demo) { label = 'Live access is not available'; caption = 'Wallet connected. Holder eligibility and token-funded access are not connected yet.'; }
    else if (pending) { label = state.busy ? 'Checking saved request…' : 'Retry the same demo request'; caption = 'A previous request is unresolved. Retry checks that request without charging twice.'; }
    else if (!eligible) { label = 'Sample access is not available'; caption = data.dashboard?.eligibility?.reason || 'Your session is not currently eligible.'; }
    else if (!affordable) { label = 'No sample days left'; caption = 'This demo has reached its weekly sample limit.'; }
    $('create-button').replaceChildren(document.createTextNode(label), icon('arrow-right'));
    $('create-caption').textContent = caption;
  }
  function render() {
    const { mode, session, catalogue, dashboard } = state.data;
    const isDemo = session?.kind === 'demo';
    const isPilot = state.data.pilotEnabled && session?.kind === 'wallet';
    if (state.pilotWallet !== session?.address) { state.pilotReady = false; state.pilotWallet = session?.address || null; }
    $('pilot-access').hidden = !isPilot;
    $('overview').hidden = isPilot;
    document.querySelector('.sidebar a[href="#overview"], .sidebar a[href="#pilot-access"]').href = isPilot ? '#pilot-access' : '#overview';
    $('plan-workspace').hidden = !session || isPilot;
    document.querySelector('.tunnels-section').hidden = !session || isPilot;
    document.querySelector('.lower-grid').hidden = !session || isPilot;
    document.querySelector('.sidebar a[href="#tunnels"]').hidden = isPilot;
    document.querySelector('.sidebar a[href="#activity"]').hidden = isPilot;
    $('guide-sidebar').hidden = isPilot;
    $('about-demo').hidden = isPilot;
    $('page-title').replaceChildren(document.createTextNode(isDemo ? 'Your sample ' : isPilot ? 'Your pilot ' : 'Holder '), element('em', '', 'access.'));
    document.querySelector('.hero-copy').textContent = isDemo ? 'Explore your sample plans and setup. Real holder access is still in development.' : isPilot ? 'Connect your approved wallet and enter your pilot access code to get a real WireGuard setup.' : session ? 'Wallet signed in. Holder eligibility and live VPN data are not available yet. Switch to the demo to explore the flow.' : 'Eligible holders are intended to receive VPN data covered by community fees. Explore a no-payment preview of how access could work.';
    $('access-preview').hidden = !!session;
    $('mode-badge').textContent = isPilot ? 'PRIVATE PILOT' : mode === 'demo' ? 'DEMO MODE' : 'PREVIEW';
    const notice = $('mode-notice').querySelector('p');
    notice.replaceChildren(element('strong', '', isPilot ? 'Limited live pilot. ' : mode === 'demo' ? 'You’re exploring a prototype. ' : 'Read-only preview. '), document.createTextNode(isPilot ? 'Approved accounts can download a real configuration. Token-funded holder access is still in development.' : 'Sample limits are illustrative. No real VPN connections or payments are made here.'));
    $('demo-button').hidden = mode !== 'demo' || isDemo;
    $('demo-button').replaceChildren(document.createTextNode(session?.kind === 'wallet' ? 'Switch to demo' : 'Explore sample access'), icon('arrow-right'));
    $('wallet-button').hidden = session?.kind === 'wallet';
    $('logout-button').hidden = !session;
    $('session-label').textContent = isDemo ? 'Demo workspace · no real connection or payment.' : session ? `Wallet ${session.address.slice(0, 6)}…${session.address.slice(-4)}` : mode === 'demo' ? 'No wallet needed to explore' : 'Live access is not available yet';
    $('service-footer-status').textContent = isPilot ? 'Private pilot access. Wider holder service is in development.' : 'Built to explore. Not yet a live service.';
    if (isPilot) {
      try { $('pilot-grant').value = sessionStorage.getItem(`velora:pilot:${session.address.toLowerCase()}`) || ''; }
      catch { $('pilot-grant').value = ''; }
    } else {
      $('pilot-grant').value = '';
      $('pilot-result').hidden = true;
    }
    $('pilot-download').disabled = state.busy || !state.pilotReady;
    const countries = catalogue?.countries || [];
    $('country').replaceChildren(...countries.map((country) => {
      const option = element('option', '', country.name);
      option.value = country.code;
      return option;
    }));
    const plan = catalogue?.plans?.find((item) => item.id === 'day');
    if (plan) {
      $('plan-name').textContent = plan.name;
      $('plan-detail').textContent = `${plan.bandwidthGb} GB sample data · Australia`;
      $('plan-price').replaceChildren(document.createTextNode('Included'), element('span', '', 'IN THE DEMO'));
    }
    const allowance = dashboard?.allowance;
    const remainingDays = isDemo ? sampleDays(allowance?.remainingCents, plan?.priceCents) : null;
    const usedDays = isDemo ? sampleDays(allowance?.spentCents, plan?.priceCents) : null;
    const totalDays = isDemo ? sampleDays(allowance?.totalCents, plan?.priceCents) : null;
    $('allowance-title').textContent = isDemo ? 'Sample access available' : 'Holder access status';
    $('allowance-badge').textContent = isDemo ? 'SAMPLE ACCESS' : 'NOT LIVE';
    $('allowance-amount').replaceChildren(document.createTextNode(remainingDays ?? '—'), element('span', '', remainingDays === null ? 'NOT ACTIVE' : remainingDays === 1 ? 'DAY LEFT' : 'DAYS LEFT'));
    $('allowance-description').textContent = isDemo ? 'One sample day can create or extend a plan. This is not an announced holder allocation.' : session ? 'Wallet sign-in does not activate VPN data. Eligibility and funding are still in development.' : 'Explore the demo to see sample access.';
    $('allowance-spent').previousElementSibling.textContent = isDemo ? 'Days allocated' : 'Wallet';
    $('allowance-total').previousElementSibling.textContent = isDemo ? 'Demo weekly limit' : 'VPN data';
    $('allowance-spent').textContent = isDemo ? usedDays === null ? '—' : daysLabel(usedDays) : 'Signed in';
    $('allowance-total').textContent = isDemo ? totalDays === null ? '—' : daysLabel(totalDays) : 'Not live';
    const percentage = isDemo && allowance && allowance.totalCents > 0 ? Math.min(100, Math.max(0, allowance.remainingCents / allowance.totalCents * 100)) : 0;
    $('allowance-fill').style.width = `${percentage}%`;
    $('allowance-meter').setAttribute('aria-valuenow', String(Math.round(percentage)));
    $('allowance-meter').setAttribute('aria-label', isDemo ? 'Sample access remaining this week' : 'Holder access not active');
    $('allowance-reset').textContent = isDemo && allowance?.resetsAt ? `Sample week resets ${date(allowance.resetsAt)}.` : 'Token-funded holder access is not live.';
    $('pass-eligibility').textContent = isDemo ? 'Demo account' : 'Not assessed';
    $('pass-plan').textContent = isDemo && plan ? `1 day · ${plan.bandwidthGb} GB` : 'Not available';
    $('pass-create').hidden = !isDemo;
    document.querySelector('.pool-disclaimer').textContent = isDemo || !session ? 'Token launch and fee funding are not connected in this prototype.' : 'Wallet sign-in proves ownership only. Treasury funding and token fees have not been verified.';
    renderCreate();
    renderTunnels(dashboard?.tunnels || []);
    renderActivity(dashboard?.activity || []);
  }
  function renderTunnels(tunnels) {
    $('tunnel-count').textContent = String(tunnels.length);
    $('nav-count').textContent = String(tunnels.length).padStart(2, '0');
    if (!tunnels.length) {
      const empty = element('div', 'empty-state');
      const symbol = element('div', 'empty-symbol');
      symbol.append(icon('plans'));
      symbol.setAttribute('aria-hidden', 'true');
      empty.append(symbol, element('h3', '', 'No sample plans yet'), element('p', '', state.data.session?.kind === 'demo' ? 'Create a sample plan to see how holder access could work.' : 'Explore the demo to create your first sample plan.'), element('span', 'tiny-label', 'Australia · One day · No payment'));
      $('tunnel-list').replaceChildren(empty);
      return;
    }
    const pending = pendingRequests();
    $('tunnel-list').replaceChildren(...tunnels.map((tunnel) => {
      const card = element('article', 'tunnel-card');
      const identity = element('div', 'tunnel-identity');
      const details = element('div');
      details.append(element('h3', 'tunnel-name', tunnel.name));
      const expired = tunnel.status === 'expired' || new Date(tunnel.expiresAt).getTime() <= Date.now();
      const meta = element('p', 'tunnel-meta', `${tunnel.country === 'AU' ? 'Australia' : tunnel.country} · ${expired ? 'Demo expired' : 'Sample only · not connected'}`);
      details.append(meta);
      identity.append(element('div', 'country-mark', tunnel.country), details);
      const usage = element('div', 'tunnel-usage');
      usage.append(element('strong', '', `${tunnel.usedGb} / ${tunnel.bandwidthGb} GB · sample data`), element('div', '', `${expired ? 'Expired' : 'Sample expiry'} ${date(tunnel.expiresAt, true)}`));
      const actions = element('div', 'tunnel-actions');
      const download = element('button', 'button button-outline', 'Download sample');
      download.append(icon('download'));
      download.type = 'button';
      download.setAttribute('aria-label', `Download sample text file for ${tunnel.name}`);
      download.addEventListener('click', () => downloadConfig(tunnel, download));
      const renew = element('button', 'button button-lime', pending[`renew:${tunnel.id}`] ? 'Retry extension' : 'Add 1 sample day');
      if (pending[`renew:${tunnel.id}`]) renew.append(icon('renew'));
      renew.type = 'button';
      renew.dataset.renew = tunnel.id;
      renew.setAttribute('aria-label', `${pending[`renew:${tunnel.id}`] ? 'Retry extension for' : 'Extend'} ${tunnel.name}`);
      renew.disabled = state.busy || state.data.session?.kind !== 'demo';
      renew.addEventListener('click', () => mutateTunnel(`renew:${tunnel.id}`, `/api/tunnels/${encodeURIComponent(tunnel.id)}/renew`, {}, `“${tunnel.name}” was extended in the demo.`));
      actions.append(download, renew);
      const badge = element('span', 'plan-status', expired ? 'Expired sample' : 'Demo plan');
      card.append(identity, badge, usage, actions);
      return card;
    }));
  }
  function renderActivity(activities) {
    if (!activities.length) {
      $('activity-list').replaceChildren(element('p', 'empty-inline', 'Your plan activity will appear here.'));
      return;
    }
    $('activity-list').replaceChildren(...activities.slice(0, 6).map((activity) => {
      const row = element('div', 'activity-row');
      const details = element('div', 'activity-text');
      details.append(element('strong', '', activity.label), element('span', '', `${date(activity.createdAt, true)} · Sample activity`));
      const symbol = element('div', 'activity-symbol');
      symbol.append(icon(activity.type === 'renew' ? 'renew' : 'plus'));
      const dayPrice = state.data?.catalogue?.plans?.find((item) => item.id === 'day')?.priceCents;
      const allocatedDays = sampleDays(activity.costCents, dayPrice);
      row.append(symbol, details, element('span', 'activity-cost', allocatedDays === null ? 'Sample access' : daysLabel(allocatedDays)));
      return row;
    }));
  }
  async function mutateTunnel(key, path, body, successMessage) {
    if (state.busy || state.data?.session?.kind !== 'demo') return;
    let committed = false;
    setBusy(true);
    message('');
    try {
      let pending = pendingRequests()[key];
      if (!pending) {
        pending = { path, body: { ...body, requestId: crypto.randomUUID() } };
        rememberRequest(key, pending);
      }
      await api(pending.path, pending.body);
      committed = true;
      rememberRequest(key, null);
      await refresh();
      message(successMessage);
    } catch (error) {
      if (!committed && error.status >= 400 && error.status < 500 && noCommitCodes.has(error.code)) {
        try {
          rememberRequest(key, null);
          message(`${error.message} No tunnel change was made. You can update the request and try again.`, true);
        } catch {
          message(`${error.message} No tunnel change was made, but this browser could not clear the saved request. Use Retry to check the same request.`, true);
        }
      } else {
        message(committed ? 'The demo request completed, but the dashboard could not refresh. Reload to see the updated sample access and plan.' : `${error.message} ${pendingRequests()[key] ? 'Use Retry to resume the same request.' : ''}`, true);
      }
    } finally {
      setBusy(false);
      if (state.data) renderTunnels(state.data.dashboard?.tunnels || []);
    }
  }
  async function downloadConfig(tunnel, button) {
    button.disabled = true;
    try {
      const response = await fetch(`/api/tunnels/${encodeURIComponent(tunnel.id)}/config`, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || 'The sample file could not be downloaded.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = element('a');
      link.href = url;
      link.download = 'vpn-demo-tunnel.txt';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('Sample text file downloaded. This is not a WireGuard configuration and cannot establish a VPN connection.');
    } catch (error) {
      message(error.message || 'The sample download failed. Please retry.', true);
    } finally { button.disabled = false; }
  }
  async function auth(action) {
    if (state.busy) return;
    setBusy(true);
    message('');
    try {
      await action();
      await refresh();
    } catch (error) { message(error.message || 'Your session could not be updated. Please retry.', true); }
    finally { setBusy(false); }
  }
  $('demo-button').addEventListener('click', () => auth(() => api('/api/auth/demo', {})));
  $('pilot-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy || state.data?.session?.kind !== 'wallet' || !state.data.pilotEnabled) return;
    const grant = $('pilot-grant').value.trim();
    if (!grant || grant.length > 512) { message('Enter the pilot access code you received.', true); return; }
    setBusy(true); state.pilotReady = false; message('');
    try {
      const result = await api('/api/pilot/status', { grant });
      try { sessionStorage.setItem(`velora:pilot:${state.data.session.address.toLowerCase()}`, grant); }
      catch { throw new Error('This browser cannot keep your access code for this tab. Enable session storage and try again.'); }
      $('pilot-result').textContent = `Active until ${date(result.expiresAt, true)}. Download the configuration and keep it private.`;
      $('pilot-result').hidden = false;
      state.pilotReady = true;
    } catch (error) { $('pilot-result').hidden = true; message(error.message || 'Pilot access could not be verified.', true); }
    finally { setBusy(false); }
  });
  $('pilot-download').addEventListener('click', async () => {
    if (state.busy || !state.pilotReady || state.data?.session?.kind !== 'wallet') return;
    setBusy(true); message('');
    try {
      const grant = sessionStorage.getItem(`velora:pilot:${state.data.session.address.toLowerCase()}`);
      if (!grant) throw new Error('Check your pilot access code again.');
      const response = await fetch('/api/pilot/config', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || 'The configuration could not be downloaded.'); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = element('a');
      link.href = url; link.download = 'velora-pilot.conf'; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('WireGuard setup downloaded. Import it into the WireGuard app and activate the tunnel.');
    } catch (error) { message(error.message || 'The configuration could not be downloaded. Retry this same pilot account.', true); }
    finally { setBusy(false); }
  });
  $('logout-button').addEventListener('click', () => auth(() => api('/api/auth/logout', {})));
  $('wallet-button').addEventListener('click', () => auth(async () => {
    if (!window.ethereum?.request) throw new Error('No browser wallet was found. Install an Ethereum-compatible wallet, or explore the demo without one.');
    if (!state.data?.chainId) throw new Error('The dashboard has not loaded yet. Refresh before connecting your wallet.');
    state.connecting = true;
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts?.[0]) throw new Error('The wallet did not provide an account.');
      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      if (Number.parseInt(chain, 16) !== state.data.chainId) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${state.data.chainId.toString(16)}` }] });
        } catch (error) {
          if (Number(error.code) === 4902 || Number(error.data?.originalError?.code) === 4902) {
            throw new Error(`Your wallet does not have Robinhood Chain configured. Add Robinhood Chain (chain ID ${state.data.chainId}) to your wallet, then connect again.`);
          }
          throw error;
        }
      }
      const address = accounts[0];
      const { nonce, message: challenge } = await api('/api/auth/challenge', { address });
      const hexMessage = `0x${Array.from(new TextEncoder().encode(challenge), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [hexMessage, address] });
      const currentAccounts = await window.ethereum.request({ method: 'eth_accounts' });
      const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
      if (currentAccounts?.[0]?.toLowerCase() !== address.toLowerCase() || Number.parseInt(currentChain, 16) !== state.data.chainId) {
        throw new Error('Your wallet account or network changed while signing. Connect again with the intended account.');
      }
      await api('/api/auth/verify', { nonce, signature });
    } finally { state.connecting = false; }
  }));
  $('create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('create-form').reportValidity()) return;
    const name = $('tunnel-name').value.trim();
    if (!name) { message('Give your tunnel a name first.', true); $('tunnel-name').focus(); return; }
    mutateTunnel('create', '/api/tunnels', { name, country: $('country').value, planId: 'day' }, 'Your demo plan is ready. Find it under Your plans to download a sample setup or add another day.');
  });
  const dialog = $('guide-dialog');
  ['guide-sidebar', 'guide-pool', 'about-demo'].forEach((id) => $(id).addEventListener('click', () => dialog.showModal()));
  ['close-guide', 'guide-done'].forEach((id) => $(id).addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  document.querySelectorAll('.sidebar nav a').forEach((link) => link.addEventListener('click', () => {
    document.querySelectorAll('.sidebar nav a').forEach((item) => item.classList.toggle('selected', item === link));
  }));
  let invalidating = false;
  async function walletChanged() {
    if (state.connecting || invalidating || state.data?.session?.kind !== 'wallet') return;
    invalidating = true;
    setBusy(true);
    try {
      await api('/api/auth/logout', {});
      await refresh();
      message('Your wallet account or network changed. Connect again to verify the current account.');
    } catch { message('Your wallet changed. Reload and reconnect before continuing.', true); }
    finally { invalidating = false; setBusy(false); }
  }
  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', walletChanged);
    window.ethereum.on('chainChanged', walletChanged);
  }
  setBusy(true);
  refresh().catch((error) => message(`The dashboard could not load. ${error.message} Reload the page to try again.`, true)).finally(() => setBusy(false));
})();
