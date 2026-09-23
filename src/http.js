'use strict';

class ServiceError extends Error {
  constructor(service, status, code = 'SERVICE_ERROR') {
    // Never include raw responses: they may contain invoices or credentials.
    super(`${service}: ${code} (HTTP ${status})`);
    this.status = status;
    this.code = code;
  }
}

async function request(url, options = {}, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, {
      ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('oversized response');
    return { status: response.status, text };
  } catch {
    throw new ServiceError('network', 0, 'TRANSPORT_UNCERTAIN');
  }
}

function json(text) {
  try { return JSON.parse(text); }
  catch { throw new ServiceError('response', 0, 'INVALID_JSON'); }
}

module.exports = { ServiceError, request, json };
