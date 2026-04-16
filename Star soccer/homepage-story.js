const revealItems = document.querySelectorAll("[data-reveal]");
const floatItems = document.querySelectorAll(
  ".pm-visual-frame, .pm-step-screen, .pm-video-section .video-card"
);
let syncRevealVisibility = () => {};

if (revealItems.length) {
  syncRevealVisibility = () => {
    const viewportHeight = window.innerHeight || 1;

    revealItems.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const inView =
        rect.top < viewportHeight * 0.9 && rect.bottom > viewportHeight * 0.1;
      item.classList.toggle("is-visible", inView);
    });
  };

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-visible", entry.isIntersecting);
      });
    },
    {
      threshold: 0.2,
      rootMargin: "0px 0px -10% 0px",
    }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
  syncRevealVisibility();
  window.addEventListener("scroll", syncRevealVisibility, { passive: true });
  window.addEventListener("resize", syncRevealVisibility);
  window.requestAnimationFrame(() => {
    document.documentElement.classList.add("has-motion");
  });
}

if (floatItems.length) {
  let ticking = false;

  const updateFloat = () => {
    const viewportHeight = window.innerHeight || 1;

    floatItems.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const offset = (midpoint - viewportHeight / 2) / viewportHeight;
      const shift = Math.max(-18, Math.min(18, offset * -24));
      item.style.setProperty("--float-shift", `${shift.toFixed(2)}px`);
    });

    ticking = false;
  };

  const requestUpdate = () => {
    if (ticking) {
      return;
    }

    ticking = true;
    window.requestAnimationFrame(updateFloat);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  requestUpdate();
}

if (window.location.hash) {
  window.addEventListener("load", () => {
    const target = document.querySelector(window.location.hash);
    if (!target) {
      return;
    }

    window.setTimeout(() => {
      target.scrollIntoView({
        block: "start",
      });
      syncRevealVisibility();
    }, 80);
  });
}
