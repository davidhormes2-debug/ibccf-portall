import { useCallback, useEffect, useRef, type RefObject } from "react";

interface Options {
  threshold?: number;
}

/**
 * Sticky-bottom auto-scroll for chat panels.
 *
 * Default chat behaviour (set scrollTop = scrollHeight on every message
 * change) yanks the user back to the bottom on every poll, so reading
 * older messages is impossible. This hook only auto-scrolls when:
 *   - it's the first time we see a given container element, OR
 *   - the user is currently near the bottom (within `threshold` px).
 *
 * If the user has scrolled up to read history, new messages arrive
 * silently and the scroll position is left alone.
 */
export function useChatAutoScroll<E extends HTMLElement = HTMLDivElement>(
  containerRef: RefObject<E | null>,
  deps: ReadonlyArray<unknown>,
  options: Options = {},
) {
  const { threshold = 80 } = options;
  const stickRef = useRef(true);
  const lastElRef = useRef<E | null>(null);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, [containerRef, threshold]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNewElement = lastElRef.current !== el;
    if (isNewElement || stickRef.current) {
      el.scrollTop = el.scrollHeight;
      stickRef.current = true;
    }
    lastElRef.current = el;
    // Caller-controlled deps — intentionally not statically analyzable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { onScroll };
}
