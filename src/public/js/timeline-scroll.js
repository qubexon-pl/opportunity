(function () {
  'use strict';

  // Mirrors the timeline's horizontal scrollbar in a bar pinned to the bottom of
  // the viewport, so panning sideways does not require scrolling to the end of
  // the page first. The proxy hides itself when the timeline fits or is off screen.
  function setup(scroller) {
    const proxy = document.createElement('div');
    proxy.className = 'timeline-floating-scroll';
    const spacer = document.createElement('div');
    proxy.appendChild(spacer);
    document.body.appendChild(proxy);

    let syncing = null;

    function overflows() {
      return scroller.scrollWidth - scroller.clientWidth > 1;
    }

    function inView() {
      const box = scroller.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      // Visible, and its own scrollbar is not already on screen.
      return box.top < viewportHeight && box.bottom > 0 && box.bottom > viewportHeight;
    }

    function refresh() {
      const show = overflows() && inView();
      proxy.classList.toggle('is-visible', show);
      if (!show) return;

      const box = scroller.getBoundingClientRect();
      proxy.style.left = box.left + 'px';
      proxy.style.width = box.width + 'px';
      spacer.style.width = scroller.scrollWidth + 'px';
      if (syncing !== 'proxy') proxy.scrollLeft = scroller.scrollLeft;
    }

    // The frozen header and person column overlap the rows once the board is
    // scrolled. An accent edge appears only then, so it is clear the content is
    // passing underneath rather than ending there.
    function markFrozen() {
      scroller.classList.toggle('is-scrolled-y', scroller.scrollTop > 1);
      scroller.classList.toggle('is-scrolled-x', scroller.scrollLeft > 1);
    }

    // A flag stops the two scrollbars from bouncing updates off each other.
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
    // The page scrolls inside .main-content, so that is where the movement is.
    const pane = scroller.closest('.main-content');
    if (pane) pane.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', refresh);
    if (window.ResizeObserver) new ResizeObserver(refresh).observe(scroller);

    refresh();
    markFrozen();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.timeline-scroll').forEach(setup);
  });
})();
