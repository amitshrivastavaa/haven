/**
 * React bindings. Thin on purpose — the timeline is the same shadow-DOM
 * component the vanilla API mounts, so there is only one implementation of it.
 */

import { useEffect, useRef } from "react";
import type { GrenzInstance } from "./grenz.ts";
import type { ToolDescriptor } from "./types.ts";

/**
 * Registers a tool for the lifetime of the component, unregistering via
 * AbortController on unmount — the spec's own cleanup mechanism.
 *
 * `execute` is held in a ref, so a re-render that produces a new closure does
 * NOT re-register the tool. Without this, every render of the host component
 * would tear the tool down and register it again, which the spec rejects as a
 * duplicate name and which would spam the audit timeline.
 */
export function useGrenzTool(g: GrenzInstance, tool: ToolDescriptor): void {
  const latest = useRef(tool);
  latest.current = tool;

  useEffect(() => {
    const controller = new AbortController();
    void g.registerTool(
      {
        ...latest.current,
        execute: (input, ctx) => latest.current.execute(input, ctx),
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
    // Identity of the tool is its name; everything else is read through the ref.
  }, [g, tool.name]);
}

export function GrenzTimeline({
  g,
  className,
  style,
}: {
  g: GrenzInstance;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return g.mountTimeline(ref.current);
  }, [g]);
  return <div ref={ref} className={className} style={style} />;
}
