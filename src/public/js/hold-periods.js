/* Hold periods on an assignment: add and remove date-range rows in place.
   Delegated from each hold group, so rows added later need no extra wiring. */
(function () {
  'use strict';

  function createRow() {
    var row = document.createElement('div');
    row.className = 'hold-period-row row g-2 mb-1';
    row.setAttribute('data-role', 'hold-row');
    row.innerHTML =
      '<div class="col-lg-4 col-md-5 col-5">' +
        '<label class="form-label small">Hold from</label>' +
        '<input type="date" class="form-control form-control-sm" name="holdStartDate" value="" aria-label="Hold from">' +
      '</div>' +
      '<div class="col-lg-4 col-md-5 col-5">' +
        '<label class="form-label small">Hold until</label>' +
        '<div class="input-group input-group-sm">' +
          '<input type="date" class="form-control form-control-sm rounded" name="holdEndDate" value="" aria-label="Hold until">' +
          '<button type="button" class="btn btn-outline-danger rounded-end px-2" data-role="remove-hold" title="Remove this hold period" aria-label="Remove this hold period">' +
            '<i class="bi bi-trash" aria-hidden="true"></i>' +
          '</button>' +
        '</div>' +
      '</div>';
    return row;
  }

  function initHoldGroups(root) {
    (root || document).querySelectorAll('[data-role="hold-group"]').forEach(function (group) {
      if (group._holdInit) return;
      group._holdInit = true;

      var container = group.querySelector('[data-role="hold-periods"]');

      group.addEventListener('click', function (e) {
        var removeBtn = e.target.closest('[data-role="remove-hold"]');
        if (removeBtn) {
          removeBtn.closest('[data-role="hold-row"]').remove();
          return;
        }
        if (e.target.closest('[data-role="add-hold"]')) {
          container.appendChild(createRow());
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initHoldGroups(); });
  } else {
    initHoldGroups();
  }

  window.OPP_initHoldGroups = initHoldGroups;
})();
