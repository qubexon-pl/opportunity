/**
 * Person-absences AJAX: intercepts add/edit/remove forms so the absence card
 * updates in place without a full page reload, preserving collapsed-card state.
 */
(function () {
  'use strict';

  function getPersonFromUrl() {
    var parts = window.location.pathname.split('/');
    var idx = parts.indexOf('people');
    return idx >= 0 && idx + 1 < parts.length ? decodeURIComponent(parts[idx + 1]) : '';
  }

  function getCurrentQuery() {
    return window.location.search || '';
  }

  /** Fetch fresh partial HTML and swap #absenceCard in place. */
  async function refreshAbsenceCard() {
    var person = getPersonFromUrl();
    if (!person) return;
    var query = getCurrentQuery();
    var sep = query ? '&' : '?';
    var url = '/management/people/' + encodeURIComponent(person) + query + sep + 'partial=absences';
    try {
      var resp = await fetch(url, { headers: { 'Accept': 'text/html' } });
      if (!resp.ok) throw new Error('Failed to refresh absence card');
      var html = await resp.text();
      var wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      var newCard = wrapper.querySelector('#absenceCard');
      var oldCard = document.getElementById('absenceCard');
      if (newCard && oldCard) {
        // Preserve collapse state
        var wasOpen = oldCard.querySelector('#collapseAbsence.show');
        if (wasOpen) {
          newCard.querySelector('#collapseAbsence').classList.add('show');
          var toggle = newCard.querySelector('[data-bs-target="#collapseAbsence"]');
          if (toggle) { toggle.classList.remove('collapsed'); toggle.setAttribute('aria-expanded', 'true'); }
        }
        oldCard.replaceWith(newCard);
        initAbsenceCard(newCard);
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Could not refresh: ' + e.message, 'error');
    }
  }

  /** Collect form data into a plain object. */
  function formData(form) {
    var data = {};
    new FormData(form).forEach(function (val, key) { data[key] = val; });
    return data;
  }

  function initAbsenceCard(container) {
    container = container || document;

    // Add absence form
    container.querySelectorAll('[data-absence-add]').forEach(function (form) {
      if (form.dataset.absInit) return;
      form.dataset.absInit = '1';
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var data = formData(form);
        var person = data.personName || getPersonFromUrl();
        try {
          var resp = await fetch('/api/people/' + encodeURIComponent(person) + '/absences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!resp.ok) {
            var err = await resp.json().catch(function () { return {}; });
            throw new Error(err.error || 'Failed to add absence');
          }
          if (typeof showToast === 'function') showToast('Absence added', 'success');
          await refreshAbsenceCard();
        } catch (err) {
          if (typeof showToast === 'function') showToast(err.message, 'error');
        }
      });
    });

    // Edit absence form (save button)
    container.querySelectorAll('[data-absence-edit]').forEach(function (form) {
      if (form.dataset.absInit) return;
      form.dataset.absInit = '1';
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var data = formData(form);
        var person = data.personName || getPersonFromUrl();
        var absenceId = form.dataset.absenceId;
        try {
          var resp = await fetch('/api/people/' + encodeURIComponent(person) + '/absences/' + encodeURIComponent(absenceId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!resp.ok) {
            var err = await resp.json().catch(function () { return {}; });
            throw new Error(err.error || 'Failed to update absence');
          }
          if (typeof showToast === 'function') showToast('Absence saved', 'success');
          await refreshAbsenceCard();
        } catch (err) {
          if (typeof showToast === 'function') showToast(err.message, 'error');
        }
      });
    });

    // Remove absence button
    container.querySelectorAll('[data-absence-remove]').forEach(function (btn) {
      if (btn.dataset.absInit) return;
      btn.dataset.absInit = '1';
      btn.addEventListener('click', async function () {
        var person = btn.dataset.person || getPersonFromUrl();
        var absenceId = btn.dataset.absenceId;
        if (!confirm('Remove this absence? ' + person + ' becomes available again.')) return;
        try {
          var resp = await fetch('/api/people/' + encodeURIComponent(person) + '/absences/' + encodeURIComponent(absenceId), {
            method: 'DELETE',
          });
          if (!resp.ok) {
            var err = await resp.json().catch(function () { return {}; });
            throw new Error(err.error || 'Failed to remove absence');
          }
          if (typeof showToast === 'function') showToast('Absence removed', 'success');
          await refreshAbsenceCard();
        } catch (err) {
          if (typeof showToast === 'function') showToast(err.message, 'error');
        }
      });
    });
  }

  window.OPP_initAbsenceCard = initAbsenceCard;

  document.addEventListener('DOMContentLoaded', function () {
    initAbsenceCard(document);
  });
})();
