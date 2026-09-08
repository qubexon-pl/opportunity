(function () {
  'use strict';

  // Mirrors the timeline's horizontal scrollbar in a bar pinned to the bottom of
  // the viewport, so panning sideways does not require scrolling to the end of
  // the page first. The proxy hides itself when the timeline fits or is off screen.
  function setup(scroller) {
    var proxy = document.createElement('div');
    proxy.className = 'timeline-floating-scroll';
    var spacer = document.createElement('div');
    proxy.appendChild(spacer);
    document.body.appendChild(proxy);

    var syncing = null;

    function overflows() {
      return scroller.scrollWidth - scroller.clientWidth > 1;
    }

    function inView() {
      var box = scroller.getBoundingClientRect();
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      return box.top < viewportHeight && box.bottom > 0 && box.bottom > viewportHeight;
    }

    function refresh() {
      var show = overflows() && inView();
      proxy.classList.toggle('is-visible', show);
      if (!show) return;

      var box = scroller.getBoundingClientRect();
      proxy.style.left = box.left + 'px';
      proxy.style.width = box.width + 'px';
      spacer.style.width = scroller.scrollWidth + 'px';
      if (syncing !== 'proxy') proxy.scrollLeft = scroller.scrollLeft;
    }

    function markFrozen() {
      scroller.classList.toggle('is-scrolled-y', scroller.scrollTop > 1);
      scroller.classList.toggle('is-scrolled-x', scroller.scrollLeft > 1);
    }

    proxy.addEventListener('scroll', function () {
      if (syncing === 'scroller') return;
      syncing = 'proxy';
      scroller.scrollLeft = proxy.scrollLeft;
      markFrozen();
      window.requestAnimationFrame(function () { syncing = null; });
    });

    scroller.addEventListener('scroll', function () {
      markFrozen();
      if (syncing === 'proxy') return;
      syncing = 'scroller';
      proxy.scrollLeft = scroller.scrollLeft;
      window.requestAnimationFrame(function () { syncing = null; });
    });

    window.addEventListener('scroll', refresh, { passive: true });
    var pane = scroller.closest('.main-content');
    if (pane) pane.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', refresh);
    if (window.ResizeObserver) new ResizeObserver(refresh).observe(scroller);

    refresh();
    markFrozen();
  }

  function initTimelineScroll(container) {
    container = container || document;
    // Clean up orphaned proxies from previous AJAX content swap.
    document.querySelectorAll('.timeline-floating-scroll').forEach(function (p) {
      p.remove();
    });
    container.querySelectorAll('.timeline-scroll:not([data-ts-init])').forEach(function (scroller) {
      scroller.setAttribute('data-ts-init', '');
      setup(scroller);
    });
  }

  window.OPP_initTimelineScroll = initTimelineScroll;

  document.addEventListener('DOMContentLoaded', function () {
    initTimelineScroll();
  });
})();
