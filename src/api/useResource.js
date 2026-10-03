/**
 * Loading a resource from the API, with the three states a screen has to show.
 *
 * The data used to be a constant available at import time, so no screen ever had
 * to say "loading" or "that failed". Now every screen does, and this hook is
 * where that lives rather than in five copies of the same useEffect.
 *
 * A request in flight is aborted when the arguments change or the screen
 * unmounts, so a slow answer can never overwrite a newer one.
 */
import { useEffect, useState } from "react";

export function useResource(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    let current = true;

    setState({ data: null, error: null, loading: true });

    load({ signal: controller.signal })
      .then((data) => {
        if (current) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || !current) return;
        setState({ data: null, error, loading: false });
      });

    return () => {
      current = false;
      controller.abort();
    };
    // load is rebuilt on every render; the caller's deps are what identify it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
