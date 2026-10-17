"use strict";

const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const workSurface = document.querySelector("#workspace");
let pointerFrame = 0;
let pointer = null;

workSurface.addEventListener("pointermove", event => {
  if (motionPreference.matches || event.pointerType !== "mouse") return;
  pointer = { x: event.clientX, y: event.clientY };
  if (pointerFrame) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    const bounds = workSurface.getBoundingClientRect();
    workSurface.style.setProperty("--pointer-x", `${pointer.x - bounds.left}px`);
    workSurface.style.setProperty("--pointer-y", `${pointer.y - bounds.top}px`);
  });
});

document.addEventListener("pointerdown", event => {
  if (motionPreference.matches) return;
  const button = event.target.closest(".button, .mode, .drop-area");
  if (!button || button.disabled) return;
  const bounds = button.getBoundingClientRect();
  const ring = document.createElement("span");
  ring.className = "press-ring"; ring.setAttribute("aria-hidden", "true");
  ring.style.left = `${event.clientX - bounds.left}px`; ring.style.top = `${event.clientY - bounds.top}px`;
  button.querySelectorAll(".press-ring").forEach(previous => previous.remove());
  button.append(ring);
  ring.addEventListener("animationend", () => ring.remove(), { once: true });
  setTimeout(() => ring.remove(), 650);
});

const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) { entry.target.classList.add("revealed"); revealObserver.unobserve(entry.target); }
  }
}, { threshold: .12 });
document.querySelectorAll(".guide article").forEach(article => revealObserver.observe(article));

motionPreference.addEventListener("change", () => {
  if (motionPreference.matches) {
    document.getAnimations().forEach(animation => animation.cancel());
    document.querySelectorAll(".press-ring").forEach(ring => ring.remove());
    cancelAnimationFrame(pointerFrame); pointerFrame = 0;
  }
});
document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("motion-paused", document.hidden);
  if (document.hidden) { cancelAnimationFrame(pointerFrame); pointerFrame = 0; }
});
