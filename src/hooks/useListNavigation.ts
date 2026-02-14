import { useState } from "react";
import { useInput } from "ink";

interface UseListNavigationOptions {
  itemCount: number;
  windowSize?: number;
  enabled?: boolean;
}

interface UseListNavigationResult {
  selectedIndex: number;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  visibleRange: { start: number; end: number };
  aboveCount: number;
  belowCount: number;
}

export function useListNavigation({ itemCount, windowSize, enabled = true }: UseListNavigationOptions): UseListNavigationResult {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (!enabled) return;
    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(itemCount - 1, prev + 1));
    }
  });

  let start = 0;
  let end = itemCount;
  if (windowSize && windowSize < itemCount) {
    const scrollOffset = Math.max(
      0,
      Math.min(selectedIndex - Math.floor(windowSize / 2), itemCount - windowSize)
    );
    start = Math.max(0, scrollOffset);
    end = Math.min(itemCount, start + windowSize);
  }

  return {
    selectedIndex,
    setSelectedIndex,
    visibleRange: { start, end },
    aboveCount: start,
    belowCount: itemCount - end,
  };
}
