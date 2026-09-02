/* global bootstrap */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
      if (window.bootstrap && bootstrap.Tooltip) new bootstrap.Tooltip(el);
    });

    document.querySelectorAll('.alert-dismissible[data-auto-dismiss]').forEach(function (alert) {
      window.setTimeout(function () {
        if (window.bootstrap && bootstrap.Alert) bootstrap.Alert.getOrCreateInstance(alert).close();
        else alert.remove();
      }, 6000);
    });

    if (window.location.hash) {
      const target = document.querySelector(window.location.hash);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
})();
