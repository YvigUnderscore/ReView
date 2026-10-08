// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { h } from '../lib/dom.js';

/** Codes renvoyés par Rust (`server_url.rs`, `probe.rs`, `main.rs`) → clé de message. */
const ERRORS = {
  address_empty: 'error.addressEmpty',
  address_invalid: 'error.addressInvalid',
  address_scheme: 'error.addressScheme',
  address_credentials: 'error.addressCredentials',
  unreachable: 'error.unreachable',
  timeout: 'error.timeout',
  tls: 'error.tls',
  not_review: 'error.notReview',
  http_status: 'error.httpStatus',
  store: 'error.store',
  window: 'error.window',
};

export function errorMessage(t, error) {
  const key = ERRORS[error?.code] ?? 'error.unknown';
  return t(key, { status: error?.detail ?? '' });
}

/** Hôte lisible d'une saisie, pour nommer le travail en cours (« Vérification de … »). */
export function hostOf(address) {
  const raw = address.trim().replace(/^[a-z]+:\/\//i, '');
  return raw.split(/[/?#]/)[0] || raw;
}

/**
 * Connexion à un serveur. Le récapitulatif dit ce qui sera écrit avant que quoi que ce
 * soit le soit ; la vérification nomme ce qu'elle fait ; une erreur dit quoi corriger.
 */
export function renderConnect(ctx, { address = '' } = {}) {
  const input = h('input', {
    id: 'server-address',
    class: 'input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: ctx.t('connect.placeholder'),
    value: address,
  });
  const submit = h('button', { type: 'submit', class: 'button primary' }, ctx.t('connect.submit'));
  const status = h('div', { class: 'status', role: 'status' });
  const detail = h('div', { class: 'detail' });

  const showPlainWarning = () => {
    const plain = /^http:\/\//i.test(input.value.trim());
    status.className = plain ? 'status is-warning' : 'status';
    status.textContent = plain ? ctx.t('connect.plainHttp') : '';
    detail.textContent = '';
  };
  input.addEventListener('input', showPlainWarning);

  const form = h(
    'form',
    {
      class: 'form',
      novalidate: true,
      onSubmit: async (event) => {
        event.preventDefault();
        const value = input.value;
        submit.disabled = true;
        input.disabled = true;
        status.className = 'status';
        status.textContent = ctx.t('connect.checking', { host: hostOf(value) });
        detail.textContent = '';
        try {
          await ctx.api.connect(value, ctx.t('window.serverBadge'));
          // La fenêtre du serveur est ouverte et le lanceur s'efface ; à son retour, il
          // affichera la liste des serveurs.
          ctx.go('servers');
        } catch (error) {
          status.className = 'status is-error';
          status.textContent = errorMessage(ctx.t, error);
          detail.textContent = error?.code === 'http_status' ? '' : (error?.detail ?? '');
          submit.disabled = false;
          input.disabled = false;
          input.focus();
        }
      },
    },
    h('label', { class: 'field-label', for: 'server-address' }, ctx.t('connect.label')),
    h('div', { class: 'field-row' }, input, submit),
    status,
    detail,
  );
  queueMicrotask(showPlainWarning);

  return h(
    'section',
    { 'aria-labelledby': 'connect-heading' },
    h(
      'div',
      { class: 'back' },
      h(
        'button',
        { type: 'button', class: 'link', onClick: () => ctx.go(ctx.hasServers() ? 'servers' : 'mode') },
        ctx.t('nav.back'),
      ),
    ),
    h('h1', { id: 'connect-heading' }, ctx.t('connect.heading')),
    h('p', { class: 'lead' }, ctx.t('connect.recap')),
    form,
  );
}
