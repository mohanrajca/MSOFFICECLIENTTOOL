import { CONFIG } from './config.js';
import { getSession } from './session.js';

export const ERROR_MESSAGES = {
  bad_login: 'Incorrect username or password.',
  inactive: 'This account is inactive. Please contact the administrator.',
  bad_token: 'Your session has expired or the app token is wrong. Please sign in again.',
  forbidden: 'You do not have permission to do that.',
  already_setup: 'Setup has already been completed. Please sign in.',
  last_admin: 'At least one active Admin must remain.',
};

export function apiError(err) {
  const code = err && (err.code || err.message);
  return ERROR_MESSAGES[code] || (err && err.message) || 'Something went wrong. Please try again.';
}

export async function apiCall(action, payload) {
  const res = await fetch(CONFIG.ENDPOINT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, token: CONFIG.TOKEN, session: getSession() || '', payload: payload || {} }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { const er = new Error('bad_response'); er.code = 'bad_response'; throw er; }
  if (body && body.ok) return body.data;
  const er = new Error((body && body.error) || 'unknown_error');
  er.code = er.message;
  throw er;
}
