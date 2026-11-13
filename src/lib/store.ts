// Store mínimo baseado em useSyncExternalStore. Cada área da aplicação tem o
// seu próprio store (projeto, grafo, painéis, sessões, editor), evitando um
// estado global monolítico.
import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
  /** Hook React. O seletor deve retornar um valor estável (campo do estado). */
  use<U>(selector: (s: T) => U): U;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe,
    use<U>(selector: (s: T) => U): U {
      return useSyncExternalStore(subscribe, () => selector(state));
    },
  };
}

/** Lê um valor JSON do localStorage com fallback. */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível: ignora */
  }
}
