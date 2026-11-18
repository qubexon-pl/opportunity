/* Admin: Entra ID lookup for the "add user" email box, and the team picker labels.
   Uses document-level listeners so it keeps working after live-update swaps the page. */
(function () {
  'use strict';

  var timer = null;
  var lastQuery = '';
  var active = -1;

  function parts(el) {
    var root = el && el.closest('[data-directory-search]');
    if (!root) return null;
    return { root: root, input: root.querySelector('input'), list: root.querySelector('.directory-suggestions') };
  }

  function close(p) {
    p.list.classList.add('d-none');
    p.list.innerHTML = '';
    p.input.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function item(className, text) {
    var li = document.createElement('li');
    li.className = className;
    li.textContent = text;
    return li;
  }

  function render(p, data) {
    p.list.innerHTML = '';
    var users = (data && data.users) || [];
    if (data && data.warning) p.list.appendChild(item('directory-note', data.warning));
    if (!users.length) p.list.appendChild(item('directory-note', 'No matches. You can still type the full email address.'));
    users.forEach(function (user, index) {
      var li = document.createElement('li');
      li.className = 'directory-option' + (user.listed ? ' is-listed' : '');
      li.setAttribute('role', 'option');
      li.id = 'directoryOption' + index;
      li.dataset.email = user.email;
      li.dataset.name = user.name || '';
      var name = document.createElement('span');
      name.className = 'directory-option-name';
      name.textContent = user.name || user.email;
      var email = document.createElement('span');
      email.className = 'directory-option-email';
      email.textContent = user.email + (user.listed ? ' · already has access' : '');
      li.appendChild(name);
      li.appendChild(email);
      p.list.appendChild(li);
    });
    p.list.classList.remove('d-none');
    p.input.setAttribute('aria-expanded', 'true');
    active = -1;
  }

  function search(p) {
    var query = p.input.value.trim();
    if (query.length < 2) { close(p); return; }
    if (query === lastQuery && !p.list.classList.contains('d-none')) return;
    lastQuery = query;
    p.list.innerHTML = '';
    p.list.appendChild(item('directory-note', 'Searching…'));
    p.list.classList.remove('d-none');
    fetch('/admin/directory-search?q=' + encodeURIComponent(query), {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    })
      .then(function (response) { return response.json(); })
      .then(function (data) { if (p.input.value.trim() === query) render(p, data); })
      .catch(function () { render(p, { users: [], warning: 'Directory search failed.' }); });
  }

  function choose(p, option) {
    p.input.value = option.dataset.email;
    var form = p.input.form;
    var nameField = form && form.querySelector('[name="name"]');
    if (nameField && option.dataset.name) nameField.value = option.dataset.name;
    close(p);
    lastQuery = p.input.value;
  }

  function highlight(p, index) {
    var options = p.list.querySelectorAll('.directory-option');
    if (!options.length) return;
    active = (index + options.length) % options.length;
    options.forEach(function (opt, i) { opt.classList.toggle('is-active', i === active); });
    p.input.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('input', function (event) {
    var p = parts(event.target);
    if (!p || event.target !== p.input) return;
    clearTimeout(timer);
    timer = setTimeout(function () { search(p); }, 250);
  });

  document.addEventListener('keydown', function (event) {
    var p = parts(event.target);
    if (!p || event.target !== p.input || p.list.classList.contains('d-none')) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); highlight(p, active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(p, active - 1); }
    else if (event.key === 'Escape') { close(p); }
    else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(p, p.list.querySelectorAll('.directory-option')[active]);
    }
  });

  // mousedown, so the choice lands before the input loses focus.
  document.addEventListener('mousedown', function (event) {
    var option = event.target.closest && event.target.closest('.directory-option');
    if (option) {
      event.preventDefault();
      choose(parts(option), option);
      return;
    }
    document.querySelectorAll('[data-directory-search]').forEach(function (root) {
      if (!root.contains(event.target)) close(parts(root));
    });
  });

  /* Team picker: show the ticked teams on the toggle. */
  document.addEventListener('change', function (event) {
    if (!event.target.matches || !event.target.matches('[data-team-picker-check]')) return;
    var picker = event.target.closest('.team-picker');
    var names = Array.prototype.filter
      .call(picker.querySelectorAll('input[type="checkbox"]'), function (box) { return box.checked; })
      .map(function (box) { return box.labels[0] ? box.labels[0].textContent : box.value; });
    picker.querySelector('.team-picker-label').textContent = names.join(', ') || 'Pick teams';
  });

  /* People by team: sort by last name or role; remembered across reloads. */
  var grid = document.querySelector('[data-people-grid]');
  var sortButtons = document.querySelectorAll('[data-people-sort]');
  function sortPeople(key) {
    if (!grid) return;
    var items = Array.prototype.slice.call(grid.children);
    items.sort(function (a, b) {
      var byLast = a.dataset.last.localeCompare(b.dataset.last) || a.dataset.name.localeCompare(b.dataset.name);
      if (key !== 'role') return byLast;
      var ra = a.dataset.role, rb = b.dataset.role;
      if (!ra !== !rb) return ra ? -1 : 1; // people without a role go last
      return ra.localeCompare(rb) || byLast;
    });
    items.forEach(function (item) { grid.appendChild(item); });
    sortButtons.forEach(function (btn) {
      var on = btn.dataset.peopleSort === key;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    try { localStorage.setItem('adminPeopleSort', key); } catch (_e) { /* private mode */ }
  }
  sortButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { sortPeople(btn.dataset.peopleSort); });
  });
  var saved = null;
  try { saved = localStorage.getItem('adminPeopleSort'); } catch (_e) { /* private mode */ }
  if (saved === 'role') sortPeople('role');
})();
