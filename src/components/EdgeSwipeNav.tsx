"use client";

import { useEffect } from "react";

const EDGE_ZONE = 28; // px from the screen edge where a swipe may start
const MIN_DISTANCE = 70; // px of horizontal travel needed to count as a swipe
const MAX_DURATION = 800; // ms
const WHEEL_THRESHOLD = 60; // accumulated horizontal trackpad delta needed to navigate
const WHEEL_COOLDOWN = 900; // ms; ignores the inertia tail of the same swipe

// True if the element (or an ancestor) can scroll horizontally in the swipe direction.
function canScrollX(el: EventTarget | null, dx: number): boolean {
  let node = el instanceof HTMLElement ? el : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const { overflowX } = getComputedStyle(node);
    if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth) {
      const atStart = node.scrollLeft <= 0;
      const atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
      if (dx < 0 ? !atStart : !atEnd) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Site-wide edge swipe navigation for touch screens:
 * swipe from the left edge toward the right = back,
 * swipe from the right edge toward the left = forward.
 * On laptops (MacBook / Windows precision trackpads), a two-finger swipe
 * to the right = back, to the left = forward.
 */
export default function EdgeSwipeNav() {
  useEffect(() => {
    let start: { x: number; y: number; t: number; side: "left" | "right" } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        start = null;
        return;
      }
      const { clientX: x, clientY: y } = e.touches[0];
      const width = window.innerWidth;
      if (x <= EDGE_ZONE) start = { x, y, t: Date.now(), side: "left" };
      else if (x >= width - EDGE_ZONE) start = { x, y, t: Date.now(), side: "right" };
      else start = null;
    };

    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const s = start;
      start = null;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - s.x;
      const dy = touch.clientY - s.y;
      if (Date.now() - s.t > MAX_DURATION) return;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return;

      if (s.side === "left" && dx > 0) window.history.back();
      else if (s.side === "right" && dx < 0) window.history.forward();
    };

    const onCancel = () => {
      start = null;
    };

    let wheelSum = 0;
    let lastWheel = 0;
    let lockedUntil = 0;

    const onWheel = (e: WheelEvent) => {
      // Only clearly horizontal gestures; ignore vertical scrolling and pinch-zoom.
      if (e.ctrlKey || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      if (canScrollX(e.target, e.deltaX)) return;

      // Stop the browser's own overscroll history gesture so we don't navigate twice.
      e.preventDefault();

      const now = Date.now();
      if (now < lockedUntil) return;
      if (now - lastWheel > 200) wheelSum = 0;
      lastWheel = now;
      wheelSum += e.deltaX;

      if (Math.abs(wheelSum) >= WHEEL_THRESHOLD) {
        // Fingers moving right => negative deltaX (natural scrolling) => back.
        if (wheelSum < 0) window.history.back();
        else window.history.forward();
        wheelSum = 0;
        lockedUntil = now + WHEEL_COOLDOWN;
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  return null;
}
