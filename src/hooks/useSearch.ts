import { useState, useMemo } from "react";
import { useInput } from "ink";

interface UseSearchOptions<T> {
  items: T[];
  keys: (item: T) => string[];
  enabled?: boolean;
}

interface UseSearchResult<T> {
  filteredItems: T[];
  searchActive: boolean;
  searchQuery: string;
  startSearch: () => void;
  clearSearch: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function useSearch<T>({ items, keys, enabled = true }: UseSearchOptions<T>): UseSearchResult<T> {
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useInput((input, key) => {
    if (!enabled) return;

    if (searchActive) {
      if (key.escape) {
        setSearchActive(false);
        setSearchQuery("");
      } else if (key.return) {
        setSearchActive(false);
      } else if (key.backspace || key.delete) {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setSearchQuery((q) => q + input);
      }
      return;
    }

    if (input === "/" && !key.ctrl && !key.meta) {
      setSearchActive(true);
      setSearchQuery("");
    }
  });

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    return items.filter((item) =>
      keys(item).some((text) => fuzzyMatch(searchQuery, text))
    );
  }, [items, searchQuery]);

  return {
    filteredItems,
    searchActive,
    searchQuery,
    startSearch: () => { setSearchActive(true); setSearchQuery(""); },
    clearSearch: () => { setSearchActive(false); setSearchQuery(""); },
  };
}
