const revealItems = document.querySelectorAll("[data-reveal]");
const floatItems = document.querySelectorAll(
  ".pm-visual-frame, .pm-step-screen, .pm-video-section .video-card"
);
const heroSection = document.querySelector(".immersive-hero");
const latestBand = document.querySelector(".home-latest-band");
let syncRevealVisibility = () => {};
let syncLatestBandVisibility = () => {};

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

if (heroSection && latestBand) {
  syncLatestBandVisibility = () => {
    const viewportHeight = window.innerHeight || 1;
    const rect = heroSection.getBoundingClientRect();
    const heroIsFading = rect.bottom <= viewportHeight * 0.78;

    latestBand.classList.toggle("is-active", heroIsFading);
  };

  syncLatestBandVisibility();
  window.addEventListener("scroll", syncLatestBandVisibility, { passive: true });
  window.addEventListener("resize", syncLatestBandVisibility);
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

const tabButtons = document.querySelectorAll("[data-tab-target]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");

if (tabButtons.length && tabPanels.length) {
  const activateTab = (target) => {
    tabButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tabTarget === target);
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.tabPanel === target;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
  };

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
  });

  activateTab(
    document.querySelector("[data-tab-target].is-active")?.dataset.tabTarget ||
      tabButtons[0].dataset.tabTarget
  );
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

const stripeButtons = Array.from(document.querySelectorAll('a.button[href]')).filter((link) => {
  const rawHref = link.getAttribute("href") || "";
  return rawHref.includes("buy.stripe.com") && !rawHref.includes("payment-registration.html");
});

if (stripeButtons.length && !document.body.classList.contains("payment-registration-page")) {
  stripeButtons.forEach((link) => {
    link.textContent = "Register & pay";

    link.addEventListener("click", (event) => {
      event.preventDefault();

      const card = link.closest(".session-option-block, .session-price-choice");
      const pageTitle = document.querySelector(".psg-page-title")?.textContent?.trim() || "Star Soccer";
      const pageCity = document.querySelector(".psg-page-city")?.textContent?.trim() || "";
      const heading = card?.querySelector("h3")?.textContent?.trim() || "Payment option";
      const kicker =
        card?.querySelector(".psg-row-kicker")?.textContent?.trim() ||
        card?.querySelector(".session-option-note")?.textContent?.trim() ||
        "";
      const price = card?.querySelector(".session-option-price")?.textContent?.trim() || "";
      const program = [pageTitle, pageCity].filter(Boolean).join(" | ");
      const session = kicker ? `${heading} — ${kicker}` : heading;
      const params = new URLSearchParams({
        program,
        session,
        price,
        stripe: link.href,
      });

      window.location.href = `payment-registration.html?${params.toString()}`;
    });
  });
}
