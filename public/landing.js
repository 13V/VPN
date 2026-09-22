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
    [".hero-copy > :not(h1)", 65],
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
  document.querySelectorAll(".hero-line > *").forEach((node, index) => {
    animateEntry(
      node,
      [
        { transform: "translateY(108%)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      {
        duration: 1000,
        delay: 90 + index * 115,
        easing: "cubic-bezier(.22,1,.36,1)",
        fill: "backwards",
      },
    );
  });
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
const phoneConcept = document.getElementById("phone-concept");
const phoneToggle = document.getElementById("phone-toggle");
if (concept && toggle) {
  const reducedMotion = motionPreference;
  let timer,
    started = false,
    autoTimer;
  function display(state) {
    concept.dataset.state = state;
    toggle.setAttribute("aria-checked", String(state !== "off"));
    if (phoneConcept && phoneToggle) {
      phoneConcept.dataset.state = state;
      phoneToggle.setAttribute("aria-checked", String(state !== "off"));
      document.getElementById("phone-connection-status").textContent =
        state === "on"
          ? "Connected · preview"
          : state === "connecting"
            ? "Connecting · preview"
            : "Not connected · preview";
    }
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
  function togglePreview() {
    started = true;
    observer?.disconnect();
    clearTimeout(autoTimer);
    clearTimeout(timer);
    if (concept.dataset.state === "off") connect();
    else display("off");
  }
  toggle.addEventListener("click", togglePreview);
  phoneToggle?.addEventListener("click", togglePreview);
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

// The phone follows scroll position, without changing the page's scroll behaviour.
const phoneScene = document.querySelector(".phone-scene");
if (phoneScene && "IntersectionObserver" in window) {
  let sceneVisible = false,
    frame = 0;
  function updatePhone() {
    frame = 0;
    if (!sceneVisible || motionPreference.matches || document.hidden) return;
    const bounds = phoneScene.getBoundingClientRect();
    const progress = Math.max(
      0,
      Math.min(
        1,
        (window.innerHeight - bounds.top) /
          (window.innerHeight + bounds.height),
      ),
    );
    phoneScene.dataset.motion = "scroll";
    phoneScene.style.setProperty(
      "--phone-turn",
      `${(-8 + progress * 10).toFixed(2)}deg`,
    );
    phoneScene.style.setProperty(
      "--phone-lift",
      `${(18 - progress * 36).toFixed(2)}px`,
    );
    phoneScene.style.setProperty(
      "--phone-yaw",
      `${(-9 + progress * 12).toFixed(2)}deg`,
    );
  }
  function schedulePhone() {
    if (!frame && sceneVisible && !motionPreference.matches && !document.hidden)
      frame = requestAnimationFrame(updatePhone);
  }
  function resetPhone() {
    cancelAnimationFrame(frame);
    frame = 0;
    delete phoneScene.dataset.motion;
  }
  const sceneObserver = new IntersectionObserver((entries) => {
    sceneVisible = entries[0].isIntersecting;
    if (sceneVisible) schedulePhone();
    else resetPhone();
  });
  sceneObserver.observe(phoneScene);
  window.addEventListener("scroll", schedulePhone, { passive: true });
  window.addEventListener("resize", schedulePhone, { passive: true });
  motionPreference.addEventListener("change", () => {
    resetPhone();
    schedulePhone();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetPhone();
    else schedulePhone();
  });
}

// A small desktop-only response to the pointer gives the product panel depth.
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
if (concept) {
  let pointerFrame = 0,
    pointerX = 0,
    pointerY = 0;
  function resetPanel() {
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    concept.style.removeProperty("--panel-x");
    concept.style.removeProperty("--panel-y");
  }
  concept.addEventListener("pointermove", (event) => {
    if (
      event.pointerType !== "mouse" ||
      !finePointer.matches ||
      motionPreference.matches ||
      document.hidden ||
      concept.contains(document.activeElement)
    )
      return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      const bounds = concept.getBoundingClientRect();
      const x = Math.max(
        -0.5,
        Math.min(0.5, (pointerX - bounds.left) / bounds.width - 0.5),
      );
      const y = Math.max(
        -0.5,
        Math.min(0.5, (pointerY - bounds.top) / bounds.height - 0.5),
      );
      concept.style.setProperty("--panel-x", `${(-y * 4).toFixed(2)}deg`);
      concept.style.setProperty("--panel-y", `${(x * 5).toFixed(2)}deg`);
    });
  });
  concept.addEventListener("pointerleave", resetPanel);
  concept.addEventListener("pointercancel", resetPanel);
  concept.addEventListener("focusin", resetPanel);
  window.addEventListener("blur", resetPanel);
  finePointer.addEventListener("change", resetPanel);
  motionPreference.addEventListener("change", resetPanel);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetPanel();
  });
}
