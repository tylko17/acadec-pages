import { useEffect, useState } from "react";

export type Route = { path: string; params: URLSearchParams; key: string };

function parse(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path, params: new URLSearchParams(qs ?? ""), key: raw };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export const href = (path: string, params?: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `#${path}${s ? "?" + s : ""}`;
};
