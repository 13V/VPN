"use strict";
// Native details provide accessible menus and FAQs even if scripting is disabled.
const menu = document.querySelector(".mobile-menu");
menu?.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", () => {
    menu.open = false;
  }),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu?.open) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});

// One-time reveals enhance visible content; nothing depends on JS to be readable.
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const activeAnimations = new Set();
function animateEntry(node, frames, options) {
  if (
    motionPreference.matches ||
    document.hidden ||
    typeof node?.animate !== "function"
  )
    return;
  for (const animation of activeAnimations) {
    if (animation.effect?.target === node) animation.cancel();
  }
  const animation = node.animate(frames, options);
  activeAnimations.add(animation);
  animation.finished
    .catch(() => {})
    .finally(() => activeAnimations.delete(animation));
}
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        revealObserver.unobserve(entry.target);
        if (entry.target.contains(document.activeElement)) continue;
        animateEntry(
          entry.target,
          [
            { opacity: 0, transform: "translateY(18px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 760,
            delay: Number(entry.target.dataset.revealDelay || 0),
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "backwards",
          },
        );
      }
    },
    { threshold: 0.12 },
  );
  const groups = [
    [".hero-copy > *", 65],
    [".connection-stage", 0],
    [".intro-facts > div", 75],
    [".section-intro, .idea-steps article", 65],
    [".phone-scene, .experience-copy", 70],
    [".faq-section > div:first-child, .faq-list, .footer-invitation", 0],
  ];
  for (const [selector, stagger] of groups) {
    document.querySelectorAll(selector).forEach((node, index) => {
      node.dataset.revealDelay = String(Math.min(index * stagger, 260));
      revealObserver.observe(node);
    });
  }
  // Keyboard navigation and preference changes always take priority over motion.
  document.addEventListener("focusin", (event) => {
    for (const animation of activeAnimations) {
      if (animation.effect?.target?.contains(event.target)) animation.cancel();
    }
  });
}
function finishMotion() {
  for (const animation of activeAnimations) animation.cancel();
  activeAnimations.clear();
}
motionPreference.addEventListener("change", finishMotion);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) finishMotion();
});

// Illustrative app only: no network calls, wallet access or VPN provisioning.
const concept = document.getElementById("app-concept");
const toggle = document.getElementById("connection-toggle");
if (concept && toggle) {
  const reducedMotion = motionPreference;
  let timer,
    started = false,
    autoTimer;
  function display(state) {
    concept.dataset.state = state;
    toggle.setAttribute("aria-checked", String(state !== "off"));
    document.getElementById("connection-title").textContent =
      state === "on"
        ? "You’re connected."
        : state === "connecting"
          ? "Finding your connection."
          : "Ready when you are.";
    document.getElementById("connection-description").textContent =
      state === "on"
        ? "Your day. Your connection."
        : state === "connecting"
          ? "Connecting to Sydney…"
          : "Choose a location. Make it yours.";
    document.getElementById("connection-status").textContent =
      state === "on"
        ? "Connected · preview"
        : state === "connecting"
          ? "Connecting…"
          : "Not connected";
    animateEntry(
      document.querySelector(".connection-heading"),
      [
        { opacity: 0.5, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" },
    );
  }
  function connect() {
    clearTimeout(timer);
    if (reducedMotion.matches) return display("on");
    display("connecting");
    timer = setTimeout(() => display("on"), 1100);
  }
  toggle.addEventListener("click", () => {
    started = true;
    clearTimeout(autoTimer);
    clearTimeout(timer);
    if (concept.dataset.state === "off") connect();
    else display("off");
  });
  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            if (
              entries.some((entry) => entry.isIntersecting) &&
              !started &&
              !reducedMotion.matches
            ) {
              started = true;
              autoTimer = setTimeout(() => {
                if (!document.hidden) connect();
              }, 1200);
              observer.disconnect();
            }
          },
          { threshold: 0.55 },
        )
      : null;
  observer?.observe(concept);
  reducedMotion.addEventListener("change", () => {
    clearTimeout(autoTimer);
    clearTimeout(timer);
    if (concept.dataset.state === "connecting") display("on");
  });
}
